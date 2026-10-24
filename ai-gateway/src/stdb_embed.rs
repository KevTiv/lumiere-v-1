//! Domain-specific SpacetimeDB helpers for the AI gateway embedding queue.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

const EMBEDDING_QUEUE: &str = "embedding";
const EMBEDDING_WORKER_NAME: &str = "ai-gateway-embedding-worker";

#[derive(Debug)]
pub struct PendingEmbedJob {
    pub job_id: u64,
    pub organization_id: u64,
    pub revision: u64,
    pub payload: EmbedJobPayload,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CanonicalPassage {
    pub id: u64,
    pub text: String,
    pub fingerprint: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EmbeddingIndexState {
    pub id: u64,
    pub sync_status: String,
    pub index_generation: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmbedJobPayload {
    pub operation: String,
    pub company_id: u64,
    pub content_type: String,
    pub content_id: u64,
    pub expected_fingerprint: String,
    pub index_generation: String,
}

#[derive(Debug, Clone)]
pub struct QueueLease {
    pub worker_id: u64,
    pub token: String,
    pub claimed_revision: u64,
}

#[derive(Debug, Clone, Copy)]
pub enum QueueCompletion<'a> {
    Succeeded { response_fingerprint: &'a str },
    Failed { error_summary: &'a str },
}

#[async_trait]
pub trait LumiereStdbExt {
    async fn fetch_pending_embedding_jobs(
        &self,
        limit: u32,
    ) -> anyhow::Result<Vec<PendingEmbedJob>>;
    async fn ensure_embedding_worker(&self, organization_id: u64) -> anyhow::Result<u64>;
    async fn claim_queue_job(
        &self,
        organization_id: u64,
        job_id: u64,
        expected_revision: u64,
        worker_id: u64,
        lease_token: &str,
        lease_expires_at_micros: u64,
    ) -> anyhow::Result<QueueLease>;
    async fn complete_queue_job(
        &self,
        organization_id: u64,
        job_id: u64,
        lease: &QueueLease,
        completion: QueueCompletion<'_>,
        retry_jitter_micros: u64,
    ) -> anyhow::Result<()>;
    async fn finalize_embedding_job(
        &self,
        organization_id: u64,
        company_id: u64,
        embedding_id: u64,
        model: &str,
        dimension: u32,
        job_id: u64,
        lease: &QueueLease,
        response_fingerprint: &str,
    ) -> anyhow::Result<()>;
}

fn string_field(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn u64_field(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .and_then(Value::as_u64)
        .or_else(|| row.get(snake).and_then(Value::as_u64))
        .or_else(|| {
            row.get(camel)
                .and_then(Value::as_str)
                .and_then(|value| value.parse().ok())
        })
        .or_else(|| {
            row.get(snake)
                .and_then(Value::as_str)
                .and_then(|value| value.parse().ok())
        })
}

#[async_trait]
impl LumiereStdbExt for StdbClient {
    async fn fetch_pending_embedding_jobs(
        &self,
        limit: u32,
    ) -> anyhow::Result<Vec<PendingEmbedJob>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let sql = format!(
            "SELECT id, organization_id, revision, payload, status FROM queue_job \
             WHERE queue_name = '{EMBEDDING_QUEUE}'"
        );
        let rows = self
            .query_sql(&sql)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut jobs = Vec::with_capacity(rows.len());
        for row in rows {
            if !matches!(
                string_field(&row, "status", "status").as_deref(),
                Some("Pending" | "Leased")
            ) {
                continue;
            }
            let Some(job_id) = u64_field(&row, "id", "id") else {
                continue;
            };
            let Some(organization_id) = u64_field(&row, "organizationId", "organization_id") else {
                continue;
            };
            let Some(revision) = u64_field(&row, "revision", "revision") else {
                continue;
            };
            let Some(payload_json) = row.get("payload").and_then(Value::as_str) else {
                continue;
            };
            let payload: EmbedJobPayload = match serde_json::from_str(payload_json) {
                Ok(payload) => payload,
                Err(error) => {
                    tracing::warn!(job_id, %error, "invalid embedding job payload");
                    continue;
                }
            };
            jobs.push(PendingEmbedJob {
                job_id,
                organization_id,
                revision,
                payload,
            });
            if jobs.len() >= limit as usize {
                break;
            }
        }
        Ok(jobs)
    }

    async fn ensure_embedding_worker(&self, organization_id: u64) -> anyhow::Result<u64> {
        let query = format!(
            "SELECT id, queues, is_active FROM queue_worker WHERE organization_id = {organization_id} \
             AND name = '{EMBEDDING_WORKER_NAME}' AND is_active = true LIMIT 1"
        );
        if let Some(worker_id) = active_embedding_worker_id(self.query_sql(&query).await?) {
            self.call_reducer(stdb_client::reducer_call!(
                "worker_heartbeat",
                json!([organization_id, worker_id]),
            ))
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
            return Ok(worker_id);
        }

        self.call_reducer(stdb_client::reducer_call!(
            "register_queue_worker",
            json!([
                organization_id,
                {
                    "companyId": null,
                    "name": EMBEDDING_WORKER_NAME,
                    "queues": [EMBEDDING_QUEUE],
                    "metadata": "{\"service\":\"ai-gateway\"}",
                }
            ]),
        ))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;

        active_embedding_worker_id(self.query_sql(&query).await?)
            .ok_or_else(|| anyhow::anyhow!("embedding queue worker registration was not persisted"))
    }

    async fn claim_queue_job(
        &self,
        organization_id: u64,
        job_id: u64,
        expected_revision: u64,
        worker_id: u64,
        lease_token: &str,
        lease_expires_at_micros: u64,
    ) -> anyhow::Result<QueueLease> {
        let claimed_revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("queue job revision overflow"))?;
        self.call_reducer(stdb_client::reducer_call!(
            "claim_queue_job",
            json!([
                organization_id,
                job_id,
                {
                    "expectedRevision": expected_revision,
                    "workerId": worker_id,
                    "leaseToken": lease_token,
                    "leaseExpiresAtMicros": lease_expires_at_micros,
                }
            ]),
        ))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        Ok(QueueLease {
            worker_id,
            token: lease_token.to_string(),
            claimed_revision,
        })
    }

    async fn complete_queue_job(
        &self,
        organization_id: u64,
        job_id: u64,
        lease: &QueueLease,
        completion: QueueCompletion<'_>,
        retry_jitter_micros: u64,
    ) -> anyhow::Result<()> {
        self.call_reducer(stdb_client::reducer_call!(
            "complete_queue_job",
            json!([
                organization_id,
                job_id,
                completion_params(lease, completion, retry_jitter_micros)
            ]),
        ))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))
    }

    async fn finalize_embedding_job(
        &self,
        organization_id: u64,
        company_id: u64,
        embedding_id: u64,
        model: &str,
        dimension: u32,
        job_id: u64,
        lease: &QueueLease,
        response_fingerprint: &str,
    ) -> anyhow::Result<()> {
        self.call_reducer(stdb_client::reducer_call!(
            "finalize_embedding_job",
            json!([
                organization_id,
                company_id,
                embedding_id,
                model,
                dimension,
                job_id,
                completion_params(
                    lease,
                    QueueCompletion::Succeeded {
                        response_fingerprint,
                    },
                    0,
                )
            ]),
        ))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))
    }
}

fn active_embedding_worker_id(rows: Vec<Value>) -> Option<u64> {
    rows.into_iter().find_map(|row| {
        let is_active = row
            .get("isActive")
            .or_else(|| row.get("is_active"))
            .and_then(Value::as_bool)?;
        let queues = row.get("queues")?.as_array()?;
        (is_active
            && queues
                .iter()
                .any(|queue| queue.as_str() == Some(EMBEDDING_QUEUE)))
        .then(|| u64_field(&row, "id", "id"))
        .flatten()
    })
}

/// Verify that a company belongs to the trusted organization scope.
pub async fn company_belongs_to_organization(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
) -> anyhow::Result<bool> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT organization_id FROM company WHERE id = {company_id} LIMIT 1"
        ))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    Ok(rows
        .into_iter()
        .next()
        .and_then(|row| u64_field(&row, "organizationId", "organization_id"))
        == Some(organization_id))
}

fn completion_params(
    lease: &QueueLease,
    completion: QueueCompletion<'_>,
    retry_jitter_micros: u64,
) -> Value {
    let (outcome, error_summary, response_fingerprint, jitter) = match completion {
        QueueCompletion::Succeeded {
            response_fingerprint,
        } => ("Succeeded", None, Some(response_fingerprint), 0),
        QueueCompletion::Failed { error_summary } => {
            ("Failed", Some(error_summary), None, retry_jitter_micros)
        }
    };
    json!({
        "expectedRevision": lease.claimed_revision,
        "workerId": lease.worker_id,
        "leaseToken": lease.token,
        "outcome": outcome,
        "errorSummary": error_summary,
        "responseFingerprint": response_fingerprint,
        "retryJitterMicros": jitter,
    })
}

pub async fn canonical_passage_for_job(
    stdb: &StdbClient,
    organization_id: u64,
    payload: &EmbedJobPayload,
) -> anyhow::Result<CanonicalPassage> {
    if payload.content_type != "ai_evidence_passage" {
        anyhow::bail!(
            "unsupported canonical embedding resource '{}'",
            payload.content_type
        );
    }
    if payload.expected_fingerprint.trim().is_empty() {
        anyhow::bail!("embedding job expected_fingerprint is missing");
    }
    if payload.index_generation.trim().is_empty() {
        anyhow::bail!("embedding job index_generation is missing");
    }
    let rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, content_hash, passage_text, status, text_state \
             FROM ai_evidence_passage WHERE id = {} LIMIT 1",
            payload.content_id
        ))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("canonical evidence passage is missing"))?;
    validate_canonical_passage(row, organization_id, payload)
}

pub async fn embedding_index_state_for_job(
    stdb: &StdbClient,
    organization_id: u64,
    payload: &EmbedJobPayload,
) -> anyhow::Result<EmbeddingIndexState> {
    if payload.content_type.is_empty()
        || !payload.content_type.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
    {
        anyhow::bail!("invalid embedding resource kind");
    }
    let rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, expected_fingerprint, index_generation, sync_status \
             FROM search_embedding WHERE organization_id = {organization_id} \
             AND company_id = {} AND content_type = '{}' AND content_id = {} LIMIT 1",
            payload.company_id, payload.content_type, payload.content_id
        ))
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("embedding index state is missing"))?;
    let fingerprint = string_field(&row, "expectedFingerprint", "expected_fingerprint")
        .ok_or_else(|| anyhow::anyhow!("embedding index fingerprint is missing"))?;
    if fingerprint != payload.expected_fingerprint {
        anyhow::bail!("embedding index fingerprint does not match queue job");
    }
    let state = EmbeddingIndexState {
        id: u64_field(&row, "id", "id")
            .ok_or_else(|| anyhow::anyhow!("embedding index id is missing"))?,
        sync_status: string_field(&row, "syncStatus", "sync_status")
            .ok_or_else(|| anyhow::anyhow!("embedding index sync status is missing"))?,
        index_generation: string_field(&row, "indexGeneration", "index_generation")
            .ok_or_else(|| anyhow::anyhow!("embedding index generation is missing"))?,
    };
    if state.index_generation != payload.index_generation {
        anyhow::bail!("embedding index generation does not match queue job");
    }
    let expected_status = match payload.operation.as_str() {
        "upsert" => "pending",
        "delete" => "deleted",
        operation => anyhow::bail!("unsupported embedding queue operation '{operation}'"),
    };
    if state.sync_status != expected_status {
        anyhow::bail!(
            "embedding index state is not ready for {}",
            payload.operation
        );
    }
    Ok(state)
}

fn validate_canonical_passage(
    row: Value,
    organization_id: u64,
    payload: &EmbedJobPayload,
) -> anyhow::Result<CanonicalPassage> {
    let row_organization_id = u64_field(&row, "organizationId", "organization_id")
        .ok_or_else(|| anyhow::anyhow!("canonical passage organization is missing"))?;
    let row_company_id = u64_field(&row, "companyId", "company_id")
        .ok_or_else(|| anyhow::anyhow!("canonical passage company is missing"))?;
    if row_organization_id != organization_id || row_company_id != payload.company_id {
        anyhow::bail!("canonical passage scope does not match embedding job");
    }
    if string_field(&row, "status", "status").as_deref() != Some("current") {
        anyhow::bail!("canonical passage is not current");
    }
    if string_field(&row, "textState", "text_state").as_deref() != Some("present") {
        anyhow::bail!("canonical passage text is not available for indexing");
    }
    let fingerprint = string_field(&row, "contentHash", "content_hash")
        .ok_or_else(|| anyhow::anyhow!("canonical passage content hash is missing"))?;
    if fingerprint != payload.expected_fingerprint {
        anyhow::bail!("canonical passage fingerprint does not match embedding job");
    }
    let text = string_field(&row, "passageText", "passage_text")
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("canonical passage text is empty"))?;
    let computed_fingerprint = format!("{:x}", Sha256::digest(text.as_bytes()));
    if computed_fingerprint != fingerprint {
        anyhow::bail!("canonical passage text does not match its content hash");
    }
    Ok(CanonicalPassage {
        id: payload.content_id,
        text,
        fingerprint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> EmbedJobPayload {
        let fingerprint = format!("{:x}", Sha256::digest(b"canonical text"));
        EmbedJobPayload {
            operation: "upsert".to_string(),
            company_id: 2,
            content_type: "ai_evidence_passage".to_string(),
            content_id: 9,
            expected_fingerprint: fingerprint,
            index_generation: "qdrant-v1".to_string(),
        }
    }

    #[test]
    fn embedding_payload_is_reference_only() {
        let parsed: EmbedJobPayload = serde_json::from_str(
            r#"{"operation":"upsert","company_id":2,"content_type":"ai_evidence_passage","content_id":9,"expected_fingerprint":"abc123","index_generation":"qdrant-v1"}"#,
        )
        .expect("reference-only payload");
        assert_eq!(parsed.operation, "upsert");

        let copied_text = serde_json::from_str::<EmbedJobPayload>(
            r#"{"operation":"upsert","company_id":2,"content_type":"ai_evidence_passage","content_id":9,"expected_fingerprint":"abc123","index_generation":"qdrant-v1","text":"duplicate"}"#,
        );
        assert!(copied_text.is_err());
    }

    #[test]
    fn canonical_passage_must_match_scope_state_and_fingerprint() {
        let fingerprint = payload().expected_fingerprint;
        let row = json!({
            "id": 9,
            "organizationId": 1,
            "companyId": 2,
            "contentHash": fingerprint,
            "passageText": "canonical text",
            "status": "current",
            "textState": "present",
        });
        assert_eq!(
            validate_canonical_passage(row.clone(), 1, &payload()).expect("valid passage"),
            CanonicalPassage {
                id: 9,
                text: "canonical text".to_string(),
                fingerprint: payload().expected_fingerprint,
            }
        );

        let mut wrong_scope = row.clone();
        wrong_scope["companyId"] = json!(3);
        assert!(validate_canonical_passage(wrong_scope, 1, &payload()).is_err());

        let mut restricted = row.clone();
        restricted["textState"] = json!("restricted");
        assert!(validate_canonical_passage(restricted, 1, &payload()).is_err());

        let mut stale = row;
        stale["contentHash"] = json!("new-hash");
        assert!(validate_canonical_passage(stale, 1, &payload()).is_err());
    }

    #[test]
    fn queue_completion_uses_the_claimed_revision_and_lease() {
        let lease = QueueLease {
            worker_id: 17,
            token: "opaque-token".to_string(),
            claimed_revision: 4,
        };
        let params = completion_params(
            &lease,
            QueueCompletion::Succeeded {
                response_fingerprint: "indexed:abc123",
            },
            42,
        );
        assert_eq!(params["expectedRevision"], 4);
        assert_eq!(params["workerId"], 17);
        assert_eq!(params["leaseToken"], "opaque-token");
        assert_eq!(params["outcome"], "Succeeded");
        assert_eq!(params["responseFingerprint"], "indexed:abc123");
        assert_eq!(params["retryJitterMicros"], 0);
    }
}
