/// Background embedding queue worker.
///
/// Polls the SpacetimeDB `queue_job` table for pending embedding jobs
/// (queue_name = "embedding", status = "Pending"), processes each one by:
///   1. Claiming the job (status → Processing)
///   2. Generating the embedding via Voyage AI
///   3. Upserting the vector into Qdrant
///   4. Calling mark_embedding_synced on SpacetimeDB
///   5. Completing the job (status → Completed or Failed)
///
/// This handles jobs that were enqueued via `request_embedding_job` but where
/// the client-side direct call to POST /v1/embed failed or was skipped.
use std::sync::Arc;
use std::time::Duration;

use crate::{config::Config, embeddings::EmbeddingClient, qdrant_client::VectorStore, stdb_client::StdbClient};

pub async fn run(
    config: Arc<Config>,
    embedder: Arc<EmbeddingClient>,
    vector_store: Arc<VectorStore>,
    stdb: Arc<StdbClient>,
) {
    let poll_interval = Duration::from_secs(config.worker_poll_secs);
    tracing::info!(
        poll_secs = config.worker_poll_secs,
        batch_size = config.worker_batch_size,
        "Embedding queue worker started"
    );

    loop {
        tokio::time::sleep(poll_interval).await;

        match process_batch(&config, &embedder, &vector_store, &stdb).await {
            Ok(processed) if processed > 0 => {
                tracing::info!(count = processed, "Processed embedding jobs");
            }
            Ok(_) => {} // no jobs, quiet
            Err(e) => {
                tracing::error!("Worker batch error: {}", e);
            }
        }
    }
}

async fn process_batch(
    config: &Config,
    embedder: &EmbeddingClient,
    vector_store: &VectorStore,
    stdb: &StdbClient,
) -> anyhow::Result<usize> {
    let jobs = stdb.fetch_pending_embedding_jobs(config.worker_batch_size).await?;
    let count = jobs.len();

    for job in jobs {
        let job_id = job.job_id;
        let org_id = job.organization_id;
        let payload = job.payload;

        // Claim the job atomically
        if let Err(e) = stdb.claim_queue_job(org_id, job_id).await {
            tracing::warn!(job_id, "Failed to claim job (may have been claimed already): {}", e);
            continue;
        }

        // Process: embed → Qdrant upsert → confirm
        let result = process_job(config, embedder, vector_store, stdb, &payload).await;

        match result {
            Ok((embedding_id, dim)) => {
                // Mark sync confirmed in SpacetimeDB
                if let Err(e) = stdb
                    .mark_embedding_synced(
                        Some(payload.company_id),
                        embedding_id,
                        &config.embedding_model,
                        dim,
                    )
                    .await
                {
                    tracing::warn!(job_id, "mark_embedding_synced failed: {}", e);
                }

                if let Err(e) = stdb.complete_queue_job(org_id, job_id, None).await {
                    tracing::warn!(job_id, "complete_queue_job (success) failed: {}", e);
                }
            }
            Err(e) => {
                tracing::error!(job_id, "Embedding job failed: {}", e);
                let error_msg = e.to_string();
                if let Err(ce) = stdb
                    .complete_queue_job(org_id, job_id, Some(error_msg))
                    .await
                {
                    tracing::warn!(job_id, "complete_queue_job (failure) failed: {}", ce);
                }
            }
        }
    }

    Ok(count)
}

/// Process a single embedding job. Returns (stdb_embedding_id, dim) on success.
///
/// Note: the job payload carries content_id but not the STDB SearchEmbedding.id.
/// We use content_id as the Qdrant point ID here (acceptable since content_id +
/// content_type is unique per company). A future improvement would be to store
/// the SearchEmbedding.id in the job payload.
async fn process_job(
    config: &Config,
    embedder: &EmbeddingClient,
    vector_store: &VectorStore,
    _stdb: &StdbClient,
    payload: &crate::stdb_client::EmbedJobPayload,
) -> anyhow::Result<(u64, u32)> {
    if payload.text.trim().is_empty() {
        anyhow::bail!("Job text is empty — skipping");
    }

    let snippet: String = payload.text.chars().take(200).collect();

    let vector = embedder.embed(&payload.text).await?;
    let dim = vector.len() as u32;

    vector_store
        .upsert(crate::qdrant_client::EmbedPoint {
            id: payload.content_id,
            vector,
            company_id: payload.company_id,
            content_type: payload.content_type.clone(),
            content_id: payload.content_id,
            text_snippet: snippet,
        })
        .await?;

    tracing::debug!(
        company_id = payload.company_id,
        content_type = %payload.content_type,
        content_id = payload.content_id,
        dim,
        "Worker: embedding upserted"
    );

    Ok((payload.content_id, dim))
}
