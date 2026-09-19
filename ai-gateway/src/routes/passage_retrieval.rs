//! Resolve untrusted semantic candidates to authoritative evidence passages.
//!
//! Qdrant is only a ranking index. Its payload contains identifiers and
//! fingerprints, never prompt text. Text is loaded from the persisted evidence
//! graph after the acting user's capability has been checked by the caller.

use anyhow::{Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use crate::qdrant_client::SearchResult;

const PASSAGE_RESOURCE_KIND: &str = "ai_evidence_passage";

#[derive(Debug, Clone, PartialEq)]
pub(super) struct ResolvedPassage {
    pub passage_id: u64,
    pub source_kind: String,
    pub source_key: String,
    pub source_version: String,
    pub passage_key: String,
    pub content_hash: String,
    pub text: String,
    pub label: String,
    pub score: f32,
}

/// Resolve only evidence-passage candidates. Other semantic resources remain
/// candidates for the separately authorized live-snapshot resolver.
pub(super) async fn resolve_passage_hits(
    reader: &StdbClient,
    organization_id: u64,
    company_id: u64,
    hits: &[SearchResult],
) -> Result<Vec<ResolvedPassage>> {
    let mut resolved = Vec::new();
    for hit in hits {
        if hit.record.resource_kind != PASSAGE_RESOURCE_KIND {
            continue;
        }
        let Some(passage_id) = hit
            .record
            .resource_id
            .parse::<u64>()
            .ok()
            .filter(|id| *id > 0)
        else {
            continue;
        };
        if let Some(passage) = resolve_one(
            reader,
            organization_id,
            company_id,
            passage_id,
            &hit.record.resource_version,
            &hit.record.source_fingerprint,
            hit.score,
        )
        .await?
        {
            resolved.push(passage);
        }
    }
    Ok(resolved)
}

async fn resolve_one(
    reader: &StdbClient,
    organization_id: u64,
    company_id: u64,
    passage_id: u64,
    indexed_version: &str,
    indexed_fingerprint: &str,
    score: f32,
) -> Result<Option<ResolvedPassage>> {
    let passages = reader
        .query_sql(&format!(
            "SELECT * FROM ai_evidence_passage WHERE id = {passage_id} AND organization_id = {organization_id} AND company_id = {company_id} LIMIT 1"
        ))
        .await
        .context("load authoritative evidence passage")?;
    let Some(passage) = passages.into_iter().next() else {
        return Ok(None);
    };

    let Some(source_version_id) = number(&passage, "sourceVersionId") else {
        return Ok(None);
    };
    let versions = reader
        .query_sql(&format!(
            "SELECT * FROM ai_evidence_source_version WHERE id = {source_version_id} AND organization_id = {organization_id} AND company_id = {company_id} LIMIT 1"
        ))
        .await
        .context("load authoritative evidence source version")?;
    let Some(version) = versions.into_iter().next() else {
        return Ok(None);
    };
    let Some(source_id) = number(&version, "sourceId") else {
        return Ok(None);
    };
    let sources = reader
        .query_sql(&format!(
            "SELECT * FROM ai_evidence_source WHERE id = {source_id} AND organization_id = {organization_id} LIMIT 1"
        ))
        .await
        .context("load authoritative evidence source")?;
    let Some(source) = sources.into_iter().next() else {
        return Ok(None);
    };
    Ok(resolve_rows(
        organization_id,
        company_id,
        passage_id,
        indexed_version,
        indexed_fingerprint,
        score,
        &passage,
        &version,
        &source,
    ))
}

#[allow(clippy::too_many_arguments)]
fn resolve_rows(
    organization_id: u64,
    company_id: u64,
    passage_id: u64,
    indexed_version: &str,
    indexed_fingerprint: &str,
    score: f32,
    passage: &Value,
    version: &Value,
    source: &Value,
) -> Option<ResolvedPassage> {
    let source_kind = text(passage, "sourceKind")?;
    let source_key = text(passage, "sourceKey")?;
    let source_version = text(passage, "sourceVersion")?;
    let passage_key = text(passage, "passageKey")?;
    let content_hash = text(passage, "contentHash")?;
    let passage_text = text(passage, "passageText")?;
    if number(passage, "id") != Some(passage_id)
        || number(passage, "organizationId") != Some(organization_id)
        || number(passage, "companyId") != Some(company_id)
        || text(passage, "status").as_deref() != Some("current")
        || text(passage, "textState").as_deref() != Some("present")
        || passage_text.trim().is_empty()
        || sha256_hex(&passage_text) != content_hash
        || indexed_version != content_hash
        || indexed_fingerprint != content_hash
    {
        return None;
    }

    let source_id = number(version, "sourceId")?;
    if number(version, "id") != number(passage, "sourceVersionId")
        || number(version, "organizationId") != Some(organization_id)
        || number(version, "companyId") != Some(company_id)
        || text(version, "version").as_deref() != Some(source_version.as_str())
        || text(version, "status").as_deref() != Some("current")
        || text(version, "verification").as_deref() != Some("inspected")
        || text(version, "contentHash").is_none()
    {
        return None;
    }

    let scope = text(&source, "scope");
    let source_company = number(&source, "companyId");
    let in_scope = number(source, "organizationId") == Some(organization_id)
        && match scope.as_deref() {
            Some("company") => source_company == Some(company_id),
            Some("organization") => true,
            _ => false,
        };
    if number(source, "id") != Some(source_id)
        || !in_scope
        || text(source, "sourceKind").as_deref() != Some(source_kind.as_str())
        || text(source, "sourceKey").as_deref() != Some(source_key.as_str())
    {
        return None;
    }

    let label = text(source, "title")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{source_kind}:{source_key}"));
    Some(ResolvedPassage {
        passage_id,
        source_kind,
        source_key,
        source_version,
        passage_key,
        content_hash,
        text: passage_text,
        label,
        score,
    })
}

fn text(row: &Value, camel: &str) -> Option<String> {
    row.get(camel)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
}

fn number(row: &Value, camel: &str) -> Option<u64> {
    row.get(camel)
        .and_then(Value::as_u64)
        .or_else(|| row.get(camel).and_then(Value::as_str)?.parse().ok())
}

fn sha256_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qdrant_client::SemanticIndexRecord;
    use serde_json::json;

    #[test]
    fn semantic_payload_must_name_a_persisted_passage_and_valid_id() {
        let record = |kind: &str, id: &str| SearchResult {
            score: 0.9,
            record: SemanticIndexRecord {
                organization_id: 1,
                company_id: 2,
                resource_kind: kind.into(),
                resource_id: id.into(),
                resource_version: "hash".into(),
                source_fingerprint: "hash".into(),
                embedding_model: "test".into(),
                indexed_at: "now".into(),
                tags: vec![],
            },
        };
        assert_ne!(
            record(PASSAGE_RESOURCE_KIND, "7").record.resource_kind,
            "document"
        );
        assert!(record(PASSAGE_RESOURCE_KIND, "0")
            .record
            .resource_id
            .parse::<u64>()
            .ok()
            .filter(|id| *id > 0)
            .is_none());
        assert_eq!(
            sha256_hex("passage"),
            "0886b051075687c18a9ae5075383feb8400fbe4328c6e4bd45b77b30f1e73b54"
        );
    }

    fn rows() -> (Value, Value, Value, String) {
        let body = "Returns require approval.";
        let hash = sha256_hex(body);
        (
            json!({
                "id": 7, "organizationId": 1, "companyId": 2,
                "sourceKind": "policy", "sourceKey": "returns", "sourceVersion": "2026",
                "passageKey": "p1", "contentHash": hash, "passageText": body,
                "status": "current", "textState": "present", "sourceVersionId": 8
            }),
            json!({
                "id": 8, "organizationId": 1, "companyId": 2, "sourceId": 9,
                "version": "2026", "status": "current", "verification": "inspected",
                "contentHash": "document-hash"
            }),
            json!({
                "id": 9, "organizationId": 1, "companyId": 2, "sourceKind": "policy",
                "sourceKey": "returns", "scope": "company", "title": "Returns policy"
            }),
            hash,
        )
    }

    #[test]
    fn only_current_authorized_persisted_text_resolves() {
        let (passage, version, source, hash) = rows();
        let resolved = resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &version, &source)
            .expect("current passage");
        assert_eq!(resolved.text, "Returns require approval.");
        assert_eq!(resolved.label, "Returns policy");

        for (field, denied) in [
            ("status", "withdrawn"),
            ("status", "superseded"),
            ("textState", "restricted"),
            ("textState", "tombstoned"),
        ] {
            let mut changed = passage.clone();
            changed[field] = json!(denied);
            assert!(
                resolve_rows(1, 2, 7, &hash, &hash, 0.9, &changed, &version, &source).is_none()
            );
        }

        for status in ["superseded", "access_revoked", "deleted"] {
            let mut changed = version.clone();
            changed["status"] = json!(status);
            assert!(
                resolve_rows(1, 2, 7, &hash, &hash, 0.9, &passage, &changed, &source).is_none()
            );
        }
    }

    #[test]
    fn stale_index_and_cross_scope_rows_fail_closed() {
        let (passage, version, source, hash) = rows();
        assert!(resolve_rows(1, 2, 7, "stale", &hash, 0.9, &passage, &version, &source).is_none());
        assert!(resolve_rows(1, 2, 7, &hash, "stale", 0.9, &passage, &version, &source).is_none());
        assert!(resolve_rows(1, 3, 7, &hash, &hash, 0.9, &passage, &version, &source).is_none());

        let mut tampered = passage.clone();
        tampered["passageText"] = json!("Caller supplied replacement text");
        assert!(resolve_rows(1, 2, 7, &hash, &hash, 0.9, &tampered, &version, &source).is_none());
    }
}
