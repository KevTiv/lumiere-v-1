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

use anyhow::Context;

use crate::{
    config::Config, providers::EmbedProvider, qdrant_client::VectorStore,
    stdb_embed::{
        authoritative_embedding_for_resource, company_belongs_to_organization, LumiereStdbExt,
    },
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

        let result = match company_belongs_to_organization(stdb, org_id, payload.company_id).await {
            Ok(true) => match authoritative_embedding_for_resource(
                stdb, org_id, payload.company_id, &payload.content_type, payload.content_id,
            ).await {
                Ok(Some(embedding)) => {
                    let fingerprint = embedding.embedding_hash.unwrap_or_else(|| job.input_hash.clone());
                    process_job(embedder, vector_store, org_id, embedding.id, &fingerprint, &model, &payload).await
                }
                Ok(None) => Err(anyhow::anyhow!(
                    "authoritative SearchEmbedding is missing for {} #{}",
                    payload.content_type, payload.content_id
                )),
                Err(error) => Err(error.context("failed to resolve authoritative embedding")),
            },
            Ok(false) => Err(anyhow::anyhow!(
                "embedding job company {} does not belong to organization {}",
                payload.company_id,
                org_id
            )),
            Err(error) => Err(error.context("failed to validate embedding job scope")),
        };

        match result {
            Ok((embedding_id, dim)) => {
                if let Err(e) = stdb
                    .mark_embedding_synced(
                        org_id,
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
    organization_id: u64,
    embedding_id: u64,
    source_fingerprint: &str,
    embedding_model: &str,
    payload: &crate::stdb_embed::EmbedJobPayload,
) -> anyhow::Result<(u64, u32)> {
    if payload.text.trim().is_empty() {
        anyhow::bail!("Job text is empty — skipping");
    }

    if source_fingerprint.trim().is_empty() {
        anyhow::bail!("embedding source fingerprint is missing");
    }

    let vector = embedder.embed(&payload.text).await?;
    let dim = vector.len() as u32;

    vector_store
        .upsert(crate::qdrant_client::EmbedPoint {
            id: embedding_id,
            vector,
            record: crate::qdrant_client::SemanticIndexRecord {
                organization_id,
                company_id: payload.company_id,
                resource_kind: payload.content_type.clone(),
                resource_id: payload.content_id.to_string(),
                resource_version: source_fingerprint.to_string(),
                source_fingerprint: source_fingerprint.to_string(),
                embedding_model: embedding_model.to_string(),
                indexed_at: chrono::Utc::now().to_rfc3339(),
                tags: vec![payload.content_type.clone()],
            },
        })
        .await?;

    tracing::debug!(
        company_id = payload.company_id,
        content_type = %payload.content_type,
        content_id = payload.content_id,
        dim,
        "Worker: embedding upserted"
    );

    Ok((embedding_id, dim))
}
