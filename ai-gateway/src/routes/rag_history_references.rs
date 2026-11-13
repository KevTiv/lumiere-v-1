//! Resolve exact actor-owned selectors through their current API authority.
use std::{collections::HashSet, time::Duration};

use anyhow::{bail, Context, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{harness::ActorCredentials, state::AppState};

use super::RagSource;

const MAX_REFERENCES: usize = 4;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum HistoryReference {
    Message {
        session_key: String,
        message_id: String,
    },
    Decision {
        session_key: String,
        message_id: String,
        decision_id: String,
        revision: i32,
    },
    ImportDecision {
        session_key: String,
        task_id: String,
        decision_id: String,
        revision: i32,
    },
    ImportMapping {
        session_key: String,
        task_id: String,
        batch_id: String,
        item_id: String,
        revision: i32,
    },
    ApprovalReceipt {
        task_id: String,
        event_id: String,
        revision: String,
        idempotency_key: String,
        input_hash: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        acting_for: Option<String>,
        work_scope: String,
    },
}

impl HistoryReference {
    fn label(&self) -> &'static str {
        match self {
            Self::Message { .. } => "Earlier chat message",
            Self::Decision { .. } => "Saved chat decision",
            Self::ImportDecision { .. } => "Saved import decision",
            Self::ImportMapping { .. } => "Confirmed import mapping",
            Self::ApprovalReceipt { .. } => "Saved approval receipt",
        }
    }

    fn record_id(&self) -> &str {
        match self {
            Self::Message { message_id, .. } => message_id,
            Self::Decision { decision_id, .. } | Self::ImportDecision { decision_id, .. } => {
                decision_id
            }
            Self::ImportMapping { item_id, .. } => item_id,
            Self::ApprovalReceipt { event_id, .. } => event_id,
        }
    }
}

pub(super) fn validate_history_references(references: &[HistoryReference]) -> Result<()> {
    if references.len() > MAX_REFERENCES {
        bail!("Choose up to four saved chat references");
    }
    let mut seen = HashSet::new();
    for reference in references {
        let encoded = serde_json::to_string(reference)?;
        if encoded.len() > 1_024 || !seen.insert(reference) {
            bail!("Choose distinct saved chat references with valid identities");
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ResolvedHistoryReference {
    reference: HistoryReference,
    selector: String,
    digest: String,
    pub context: Value,
}

impl ResolvedHistoryReference {
    pub fn support_id(&self) -> String {
        self.digest.clone()
    }

    pub fn source(&self) -> RagSource {
        RagSource {
            kind: "activity".into(),
            trust: "persisted".into(),
            instruction_trust: "untrusted",
            entity_type: Some("assistant_history".into()),
            entity_id: Some(self.reference.record_id().to_owned()),
            source_kind: Some("assistant_history".into()),
            passage_id: None,
            score: 1.0,
            text_snippet: self.reference.label().into(),
            label: Some(self.reference.label().into()),
            field: None,
            snapshot_at: None,
            source_key: Some(self.selector.clone()),
            source_version: Some(self.digest.clone()),
            passage_key: None,
            content_hash: Some(self.digest.clone()),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedBatch {
    organization_id: String,
    company_id: String,
    actor: String,
    references: Vec<ResolvedRow>,
}

#[derive(Deserialize)]
struct ResolvedRow {
    reference: HistoryReference,
    excerpt: Value,
}

pub(super) async fn resolve_history_references(
    state: &AppState,
    actor: &ActorCredentials,
    organization_id: u64,
    company_id: u64,
    references: &[HistoryReference],
) -> Result<Vec<ResolvedHistoryReference>> {
    validate_history_references(references)?;
    if references.is_empty() {
        return Ok(Vec::new());
    }
    let base = state
        .config
        .api_server_url
        .as_deref()
        .map(str::trim)
        .filter(|base| !base.is_empty())
        .context("Assistant history is unavailable")?;
    let response = state
        .http
        .post(format!(
            "{}/v1/ai/chat/references/resolve",
            base.trim_end_matches('/')
        ))
        .bearer_auth(&actor.stdb_token)
        .header("x-stdb-identity", &actor.identity_hex)
        .timeout(Duration::from_secs(6))
        .json(&json!({"companyId": company_id, "references": references}))
        .send()
        .await
        .context("Assistant history is unavailable")?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        bail!("A saved chat reference is unavailable");
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Assistant history is unavailable")?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            bail!("Assistant history response is too large");
        }
        body.extend_from_slice(&chunk);
    }
    let batch: ResolvedBatch =
        serde_json::from_slice(&body).context("Invalid assistant history response")?;
    checked_batch(batch, actor, organization_id, company_id, references)
}

fn checked_batch(
    batch: ResolvedBatch,
    actor: &ActorCredentials,
    organization_id: u64,
    company_id: u64,
    references: &[HistoryReference],
) -> Result<Vec<ResolvedHistoryReference>> {
    if batch.organization_id != organization_id.to_string()
        || batch.company_id != company_id.to_string()
        || batch.actor != actor.identity_hex
        || batch.references.len() != references.len()
    {
        bail!("Saved chat references do not match the active session");
    }
    batch
        .references
        .into_iter()
        .zip(references)
        .map(|(row, expected)| {
            if &row.reference != expected || !row.excerpt.is_object() {
                bail!("Saved chat references do not match the selected revisions");
            }
            let selector = serde_json::to_string(expected)?;
            let digest = format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&(expected, &row.excerpt))?)
            );
            Ok(ResolvedHistoryReference {
                reference: row.reference,
                selector,
                context: json!({
                    "kind": "assistant_history",
                    "id": digest,
                    "label": expected.label(),
                    "instruction_trust": "untrusted",
                    "excerpt": row.excerpt,
                }),
                digest,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_only_the_exact_actor_company_and_reference() {
        let actor = ActorCredentials::new("test-token", "a".repeat(64)).expect("actor");
        let expected = HistoryReference::Message {
            session_key: "thread-1".into(),
            message_id: "7".into(),
        };
        let response = |company: &str, reference: HistoryReference| ResolvedBatch {
            organization_id: "1".into(),
            company_id: company.into(),
            actor: actor.identity_hex.clone(),
            references: vec![ResolvedRow {
                reference,
                excerpt: json!({"content": "old question"}),
            }],
        };
        let request = std::slice::from_ref(&expected);
        let resolved = checked_batch(response("2", expected.clone()), &actor, 1, 2, request)
            .expect("scoped reference");
        assert_eq!(resolved[0].source().instruction_trust, "untrusted");
        assert_eq!(resolved[0].context["excerpt"]["content"], "old question");
        assert!(checked_batch(response("3", expected.clone()), &actor, 1, 2, request).is_err());
        assert!(checked_batch(
            response(
                "2",
                HistoryReference::Message {
                    session_key: "thread-1".into(),
                    message_id: "8".into()
                }
            ),
            &actor,
            1,
            2,
            request
        )
        .is_err());
    }
}
