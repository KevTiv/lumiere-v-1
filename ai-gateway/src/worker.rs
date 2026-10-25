//! Background worker for reference-only semantic-index jobs.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use uuid::Uuid;

use crate::{
    config::Config,
    providers::EmbedProvider,
    qdrant_client::VectorStore,
    stdb_embed::{
        canonical_passage_for_job, embedding_index_state_for_job, EmbedJobPayload, LumiereStdbExt,
        QueueCompletion,
    },
};
use stdb_client::StdbClient;

const LEASE_TTL_MICROS: u64 = 5 * 60 * 1_000_000;
const MAX_RETRY_JITTER_MICROS: u64 = 60 * 1_000_000;

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
        "embedding queue worker started"
    );

    loop {
        tokio::time::sleep(poll_interval).await;
        match process_batch(&config, embedder.as_ref(), &vector_store, &stdb).await {
            Ok(processed) if processed > 0 => {
                tracing::info!(count = processed, "processed embedding jobs");
            }
            Ok(_) => {}
            Err(error) => tracing::error!(%error, "embedding worker batch failed"),
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
    let mut worker_ids = HashMap::new();

    for job in jobs {
        let worker_id = match worker_ids.get(&job.organization_id).copied() {
            Some(worker_id) => worker_id,
            None => match stdb.ensure_embedding_worker(job.organization_id).await {
                Ok(worker_id) => {
                    worker_ids.insert(job.organization_id, worker_id);
                    worker_id
                }
                Err(error) => {
                    tracing::error!(job_id = job.job_id, %error, "worker registration failed");
                    continue;
                }
            },
        };
        let lease_token = fresh_lease_token();
        let lease_expires_at_micros = now_micros()
            .checked_add(LEASE_TTL_MICROS)
            .ok_or_else(|| anyhow::anyhow!("embedding lease expiry overflow"))?;
        let lease = match stdb
            .claim_queue_job(
                job.organization_id,
                job.job_id,
                job.revision,
                worker_id,
                &lease_token,
                lease_expires_at_micros,
            )
            .await
        {
            Ok(lease) => lease,
            Err(error) => {
                tracing::warn!(job_id = job.job_id, %error, "embedding job claim failed");
                continue;
            }
        };

        let result = process_claimed_job(
            embedder,
            vector_store,
            stdb,
            job.organization_id,
            &model,
            &job.payload,
        )
        .await;

        match result {
            Ok(processed) => {
                let response_fingerprint = response_fingerprint(&processed);
                let completion = if job.payload.operation == "upsert" {
                    stdb.finalize_embedding_job(
                        job.organization_id,
                        job.payload.company_id,
                        processed.embedding_state_id,
                        &model,
                        processed.dimension,
                        job.job_id,
                        &lease,
                        &response_fingerprint,
                    )
                    .await
                } else {
                    stdb.complete_queue_job(
                        job.organization_id,
                        job.job_id,
                        &lease,
                        QueueCompletion::Succeeded {
                            response_fingerprint: &response_fingerprint,
                        },
                        0,
                    )
                    .await
                };
                if let Err(error) = completion {
                    // The external upsert/delete is idempotent. Leave the job leased so
                    // lease expiry causes a safe retry. Never report success when the
                    // authoritative synchronization transaction failed.
                    tracing::error!(
                        job_id = job.job_id,
                        %error,
                        "embedding job finalization failed; job was not completed"
                    );
                }
            }
            Err(error) => {
                tracing::error!(job_id = job.job_id, %error, "embedding job failed");
                let error_summary = error.to_string();
                if let Err(completion_error) = stdb
                    .complete_queue_job(
                        job.organization_id,
                        job.job_id,
                        &lease,
                        QueueCompletion::Failed {
                            error_summary: &error_summary,
                        },
                        retry_jitter_micros(job.job_id),
                    )
                    .await
                {
                    tracing::warn!(
                        job_id = job.job_id,
                        %completion_error,
                        "failed to schedule embedding job retry"
                    );
                }
            }
        }
    }

    Ok(count)
}

struct ProcessedEmbedding {
    embedding_state_id: u64,
    source_fingerprint: String,
    dimension: u32,
}

async fn process_claimed_job(
    embedder: &dyn EmbedProvider,
    vector_store: &VectorStore,
    stdb: &StdbClient,
    organization_id: u64,
    embedding_model: &str,
    payload: &EmbedJobPayload,
) -> anyhow::Result<ProcessedEmbedding> {
    let index_state = embedding_index_state_for_job(stdb, organization_id, payload)
        .await
        .context("failed to load embedding index state")?;
    match payload.operation.as_str() {
        "upsert" => {
            let passage = canonical_passage_for_job(stdb, organization_id, payload)
                .await
                .context("failed to load canonical passage")?;
            let vector = embedder.embed(&passage.text).await?;
            let dimension =
                u32::try_from(vector.len()).context("embedding vector dimension exceeds u32")?;
            vector_store
                .upsert(crate::qdrant_client::EmbedPoint {
                    // The index-state ID is stable across retries and matches the
                    // authoritative vector_db_id written by finalization.
                    id: point_id(index_state.id),
                    vector,
                    record: crate::qdrant_client::SemanticIndexRecord {
                        organization_id,
                        company_id: payload.company_id,
                        resource_kind: payload.content_type.clone(),
                        resource_id: passage.id.to_string(),
                        resource_version: passage.fingerprint.clone(),
                        source_fingerprint: passage.fingerprint.clone(),
                        embedding_model: embedding_model.to_string(),
                        indexed_at: chrono::Utc::now().to_rfc3339(),
                        tags: vec![
                            payload.content_type.clone(),
                            format!("index_generation:{}", payload.index_generation),
                        ],
                    },
                })
                .await?;
            Ok(ProcessedEmbedding {
                embedding_state_id: index_state.id,
                source_fingerprint: passage.fingerprint,
                dimension,
            })
        }
        "delete" => {
            vector_store.delete(point_id(index_state.id)).await?;
            Ok(ProcessedEmbedding {
                embedding_state_id: index_state.id,
                source_fingerprint: payload.expected_fingerprint.clone(),
                dimension: 0,
            })
        }
        operation => anyhow::bail!("unsupported embedding queue operation '{operation}'"),
    }
}

fn response_fingerprint(processed: &ProcessedEmbedding) -> String {
    processed.source_fingerprint.clone()
}

fn point_id(embedding_state_id: u64) -> u64 {
    embedding_state_id
}

fn fresh_lease_token() -> String {
    format!("embedding-lease:{}", Uuid::new_v4())
}

fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros()
        .try_into()
        .unwrap_or(u64::MAX - LEASE_TTL_MICROS)
}

fn retry_jitter_micros(job_id: u64) -> u64 {
    job_id % (MAX_RETRY_JITTER_MICROS + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_uses_a_bounded_deterministic_jitter() {
        assert_eq!(retry_jitter_micros(42), 42);
        assert!(retry_jitter_micros(u64::MAX) <= MAX_RETRY_JITTER_MICROS);
    }

    #[test]
    fn response_fingerprint_is_the_canonical_source_fingerprint() {
        let processed = ProcessedEmbedding {
            embedding_state_id: 7,
            source_fingerprint: "abc123".to_string(),
            dimension: 768,
        };
        assert_eq!(response_fingerprint(&processed), "abc123");
    }

    #[test]
    fn point_id_is_stable_across_retries() {
        assert_eq!(point_id(17), 17);
        assert_eq!(point_id(17), point_id(17));
    }

    #[test]
    fn lease_tokens_are_opaque_and_unique() {
        let first = fresh_lease_token();
        let second = fresh_lease_token();
        assert!(first.starts_with("embedding-lease:"));
        assert_ne!(first, second);
    }
}
