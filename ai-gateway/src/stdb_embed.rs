//! Domain-specific SpacetimeDB helpers for the AI gateway (embedding queue).

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use stdb_client::StdbClient;

#[derive(Debug)]
pub struct PendingEmbedJob {
    pub job_id: u64,
    pub organization_id: u64,
    pub payload: EmbedJobPayload,
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
            "SELECT id, organization_id, payload FROM queue_job \
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
