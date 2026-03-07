/// SpacetimeDB HTTP client.
///
/// Uses SpacetimeDB's HTTP API to:
///   - Call reducers: POST /v1/call/{module}/{reducer}
///   - Query tables:  POST /v1/sql/{module}
///
/// Auth: Bearer token (STDB_TOKEN env var). For local dev, any non-empty string works.
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone)]
pub struct StdbClient {
    http: reqwest::Client,
    base_url: String,
    module: String,
    token: String,
}

/// A single pending embedding job returned from the QueueJob table.
#[derive(Debug)]
pub struct PendingEmbedJob {
    pub job_id: u64,
    pub organization_id: u64,
    pub payload: EmbedJobPayload,
}

/// JSON payload stored in QueueJob.payload for embedding jobs.
#[derive(Debug, Deserialize)]
pub struct EmbedJobPayload {
    pub company_id: u64,
    pub content_type: String,
    pub content_id: u64,
    pub text: String,
}

#[derive(Serialize)]
struct SqlRequest {
    query: String,
}

impl StdbClient {
    pub fn new(base_url: String, module: String, token: String) -> Self {
        StdbClient {
            http: reqwest::Client::new(),
            base_url,
            module,
            token,
        }
    }

    /// Call a SpacetimeDB reducer via HTTP.
    /// `args` is serialized as a JSON array matching the reducer's parameter order
    /// (excluding the implicit `ctx: &ReducerContext` first param).
    pub async fn call_reducer(&self, reducer: &str, args: Value) -> Result<()> {
        let url = format!("{}/v1/call/{}/{}", self.base_url, self.module, reducer);

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .header("Content-Type", "application/json")
            .json(&args)
            .send()
            .await
            .with_context(|| format!("Failed to call reducer '{}'", reducer))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Reducer '{}' failed {}: {}", reducer, status, body);
        }

        Ok(())
    }

    /// Confirm that an embedding has been synced to Qdrant.
    pub async fn mark_embedding_synced(
        &self,
        company_id: Option<u64>,
        embedding_id: u64,
        model: &str,
        dim: u32,
    ) -> Result<()> {
        // Args match: mark_embedding_synced(ctx, company_id, embedding_id, model, dim)
        self.call_reducer(
            "mark_embedding_synced",
            serde_json::json!([company_id, embedding_id, model, dim]),
        )
        .await
    }

    /// Mark a QueueJob as completed (or failed with an error message).
    pub async fn complete_queue_job(
        &self,
        organization_id: u64,
        job_id: u64,
        error_message: Option<String>,
    ) -> Result<()> {
        // Args match: complete_queue_job(ctx, organization_id, job_id, error_message)
        self.call_reducer(
            "complete_queue_job",
            serde_json::json!([organization_id, job_id, error_message]),
        )
        .await
    }

    /// Claim a pending QueueJob for processing (sets status = Processing).
    pub async fn claim_queue_job(&self, organization_id: u64, job_id: u64) -> Result<()> {
        // Args match: claim_queue_job(ctx, organization_id, job_id)
        self.call_reducer(
            "claim_queue_job",
            serde_json::json!([organization_id, job_id]),
        )
        .await
    }

    /// Query for pending embedding jobs via SpacetimeDB SQL API.
    /// Returns up to `limit` jobs that are in Pending status.
    pub async fn fetch_pending_embedding_jobs(
        &self,
        limit: u32,
    ) -> Result<Vec<PendingEmbedJob>> {
        let url = format!("{}/v1/sql/{}", self.base_url, self.module);

        let sql = format!(
            "SELECT id, organization_id, payload FROM queue_job \
             WHERE queue_name = 'embedding' AND status = 'Pending' \
             LIMIT {}",
            limit
        );

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .header("Content-Type", "application/json")
            .json(&SqlRequest { query: sql })
            .send()
            .await
            .context("Failed to query pending embedding jobs")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("SQL query failed {}: {}", status, body);
        }

        // SpacetimeDB SQL response: array of row arrays [ [id, org_id, payload], ... ]
        // with a separate schema field. We parse conservatively.
        let rows: Value = resp.json().await.context("Failed to parse SQL response")?;

        let mut jobs = Vec::new();
        if let Some(row_array) = rows.as_array() {
            for row in row_array {
                // Each row is itself an array: [id, organization_id, payload_json_string]
                let cols = match row.as_array() {
                    Some(c) => c,
                    None => continue,
                };
                if cols.len() < 3 {
                    continue;
                }

                let job_id = match cols[0].as_u64() {
                    Some(v) => v,
                    None => continue,
                };
                let organization_id = match cols[1].as_u64() {
                    Some(v) => v,
                    None => continue,
                };
                // payload is stored as a JSON string
                let payload_str = match cols[2].as_str() {
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
        }

        Ok(jobs)
    }
}
