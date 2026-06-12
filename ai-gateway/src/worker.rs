/// Background embedding queue worker.
///
/// Polls the SpacetimeDB `queue_job` table for pending embedding jobs
/// (queue_name = "embedding", status = "Pending"), processes each one by:
///   1. Claiming the job (status → Processing)
///   2. Generating the embedding via the unified EmbedProvider
///   3. Upserting the vector into Qdrant
///   4. Calling mark_embedding_synced on SpacetimeDB
///   5. Completing the job (status → Completed or Failed)
use std::sync::Arc;
use std::time::Duration;

use crate::{
    config::Config,
    providers::EmbedProvider,
    qdrant_client::VectorStore,
    stdb_embed::LumiereStdbExt,
};
use stdb_client::StdbClient;

pub async fn run(
    config: Arc<Config>,
    embedder: Arc<dyn EmbedProvider>,
    vector_store: Arc<VectorStore>,
    stdb: Arc<StdbClient>,
) {
    let poll_interval = Duration::from_secs(config.worker_poll_secs);
    tracing::info!(
        poll_secs = config.worker_poll_secs,
        batch_size = config.worker_batch_size,
        embed_provider = embedder.name(),
        "Embedding queue worker started"
    );

    loop {
        tokio::time::sleep(poll_interval).await;

        match process_batch(&config, embedder.as_ref(), &vector_store, &stdb).await {
            Ok(processed) if processed > 0 => {
                tracing::info!(count = processed, "Processed embedding jobs");
            }
            Ok(_) => {}
            Err(e) => {
                tracing::error!("Worker batch error: {}", e);
            }
        }
    }
}

async fn process_batch(
    config: &Config,
    embedder: &dyn EmbedProvider,
    vector_store: &VectorStore,
    stdb: &StdbClient,
) -> anyhow::Result<usize> {
    let jobs = stdb
        .fetch_pending_embedding_jobs(config.worker_batch_size)
        .await?;
    let count = jobs.len();
    let model = config.embedding_model_name();

    for job in jobs {
        let job_id = job.job_id;
        let org_id = job.organization_id;
        let payload = job.payload;

        if let Err(e) = stdb.claim_queue_job(org_id, job_id).await {
            tracing::warn!(
                job_id,
                "Failed to claim job (may have been claimed already): {}",
                e
            );
            continue;
        }

        let result = process_job(embedder, vector_store, &payload).await;

        match result {
            Ok((embedding_id, dim)) => {
                if let Err(e) = stdb
                    .mark_embedding_synced(
                        Some(payload.company_id),
                        embedding_id,
                        &model,
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

async fn process_job(
    embedder: &dyn EmbedProvider,
    vector_store: &VectorStore,
    payload: &crate::stdb_embed::EmbedJobPayload,
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
