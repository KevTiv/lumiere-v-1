//! Domain-specific SpacetimeDB helpers for the AI gateway (embedding queue).

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use stdb_client::StdbClient;

#[derive(Debug)]
pub struct PendingEmbedJob {
    pub job_id: u64,
    pub organization_id: u64,
    pub input_hash: String,
    pub payload: EmbedJobPayload,
}

#[derive(Debug)]
pub struct AuthoritativeEmbedding {
    pub id: u64,
    pub embedding_hash: Option<String>,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct EmbedJobPayload {
    pub company_id: u64,
    pub content_type: String,
    pub content_id: u64,
    pub text: String,
}

#[async_trait]
pub trait LumiereStdbExt {
    async fn fetch_pending_embedding_jobs(
        &self,
        limit: u32,
    ) -> anyhow::Result<Vec<PendingEmbedJob>>;
    async fn mark_embedding_synced(
        &self,
        organization_id: u64,
        company_id: Option<u64>,
        embedding_id: u64,
        model: &str,
        dim: u32,
    ) -> anyhow::Result<()>;
    async fn complete_queue_job(
        &self,
        organization_id: u64,
        job_id: u64,
        error_message: Option<String>,
    ) -> anyhow::Result<()>;
    async fn claim_queue_job(&self, organization_id: u64, job_id: u64) -> anyhow::Result<()>;
    async fn organization_id_for_company(&self, company_id: u64) -> anyhow::Result<Option<u64>>;
}

fn string_field(row: &serde_json::Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel).or_else(|| row.get(snake)).and_then(|value| value.as_str()).map(str::to_string)
}

fn u64_field(row: &serde_json::Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .and_then(|v| v.as_u64())
        .or_else(|| row.get(snake).and_then(|v| v.as_u64()))
        .or_else(|| {
            row.get(camel)
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
        })
        .or_else(|| {
            row.get(snake)
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
        })
}

#[async_trait]
impl LumiereStdbExt for StdbClient {
    async fn fetch_pending_embedding_jobs(
        &self,
        limit: u32,
    ) -> anyhow::Result<Vec<PendingEmbedJob>> {
        let sql = format!(
            "SELECT id, organization_id, input_hash, payload FROM queue_job \
             WHERE queue_name = 'embedding' AND status = 'Pending' \
             LIMIT {limit}"
        );
        let rows = self
            .query_sql(&sql)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut jobs = Vec::new();
        for row in rows {
            let job_id = match u64_field(&row, "id", "id") {
                Some(v) => v,
                None => continue,
            };
            let organization_id = match u64_field(&row, "organizationId", "organization_id") {
                Some(v) => v,
                None => continue,
            };
            let input_hash = string_field(&row, "inputHash", "input_hash").unwrap_or_default();
            let payload_str = match row.get("payload").and_then(|v| v.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let payload: EmbedJobPayload = match serde_json::from_str(payload_str) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(job_id, "Failed to parse job payload: {}", e);
                    continue;
                }
            };
            jobs.push(PendingEmbedJob {
                job_id,
                organization_id,
                input_hash,
                payload,
            });
        }
        Ok(jobs)
    }

    async fn mark_embedding_synced(
        &self,
        organization_id: u64,
        company_id: Option<u64>,
        embedding_id: u64,
        model: &str,
        dim: u32,
    ) -> anyhow::Result<()> {
        self.call_reducer(stdb_client::reducer_call!(
            "mark_embedding_synced",
            json!([organization_id, company_id, embedding_id, model, dim]),
        ))
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn complete_queue_job(
        &self,
        organization_id: u64,
        job_id: u64,
        error_message: Option<String>,
    ) -> anyhow::Result<()> {
        self.call_reducer(stdb_client::reducer_call!(
            "complete_queue_job",
            json!([organization_id, job_id, error_message]),
        ))
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn claim_queue_job(&self, organization_id: u64, job_id: u64) -> anyhow::Result<()> {
        self.call_reducer(stdb_client::reducer_call!(
            "claim_queue_job",
            json!([organization_id, job_id])
        ))
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn organization_id_for_company(&self, company_id: u64) -> anyhow::Result<Option<u64>> {
        let sql = format!("SELECT organization_id FROM company WHERE id = {company_id} LIMIT 1");
        let rows = self
            .query_sql(&sql)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let row = rows.into_iter().next();
        Ok(row.and_then(|r| u64_field(&r, "organizationId", "organization_id")))
    }
}

/// Verify a company belongs to the trusted organization scope before Qdrant I/O.
pub async fn company_belongs_to_organization(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
) -> anyhow::Result<bool> {
    Ok(stdb.organization_id_for_company(company_id).await? == Some(organization_id))
}

pub async fn authoritative_embedding_for_resource(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    resource_kind: &str,
    resource_id: u64,
) -> anyhow::Result<Option<AuthoritativeEmbedding>> {
    if resource_kind.is_empty()
        || !resource_kind.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        anyhow::bail!("invalid semantic resource kind");
    }
    let sql = format!(
        "SELECT id, embedding_hash, text FROM search_embedding WHERE organization_id = {organization_id} AND company_id = {company_id} AND content_type = '{resource_kind}' AND content_id = {resource_id} AND sync_status = 'pending' LIMIT 1"
    );
    let rows = stdb.query_sql(&sql).await.map_err(|error| anyhow::anyhow!("{error}"))?;
    Ok(rows.into_iter().next().and_then(|row| Some(AuthoritativeEmbedding {
        id: u64_field(&row, "id", "id")?,
        embedding_hash: string_field(&row, "embeddingHash", "embedding_hash"),
        text: string_field(&row, "text", "text")?,
    })))
}
