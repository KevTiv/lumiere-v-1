//! Bounded SpacetimeDB → PostgreSQL projection worker.
//!
//! The worker follows the durable cursor written by the reducer commit
//! protocol. For each organization it reads exactly `next_sequence`, fetches
//! that commit's complete ordered row changes, and delegates atomic
//! application to [`super::commit_projection::apply_commit`]. It never scans
//! business tables or reconstructs reducer outcomes.

use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::{bail, Context, Result};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::get,
    Router,
};
use serde_json::json;
use stdb_client::StdbClient;

use super::{finalization_worker, migrate, pg_pool, projection_observability};
use crate::{config::Config, state::AppState};

/// Generated all-table projection codec artifact from the pinned contracts
/// release. This worker never accepts a caller-selected schema or SQL destination.
pub const PROJECTION_CODEC_MANIFEST_JSON: &str =
    lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST;
const MAX_CHANGES_PER_COMMIT: usize = 10_000;
static CURSOR_SCAN_AFTER: AtomicU64 = AtomicU64::new(0);

mod decode;
mod drain;
mod relations;
mod source;
mod status;

/// Read a bounded set of organization cursors and apply each exact next commit.
pub use drain::drain_batch;
pub use relations::ensure_projection_relations;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionDrainStats {
    pub organizations: usize,
    pub commits: usize,
    pub already_applied: usize,
    pub failed: usize,
}

fn require_server_identity(stdb: &StdbClient) -> Result<()> {
    if stdb.token().trim().is_empty() || stdb.token() == "local-dev-token" {
        bail!(
            "projection worker requires a configured STDB server/admin identity for private commit tables"
        );
    }
    Ok(())
}

/// Start the standalone projection worker service.
pub async fn serve() -> Result<()> {
    let config = Config::from_env()?;
    if config.stdb_server_token.is_none() {
        bail!(
            "projection worker requires STDB_SERVER_TOKEN to read private commit protocol tables"
        );
    }
    let poll_secs = std::env::var("LUMIERE_PROJECTION_WORKER_POLL_SECS")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(5u64);
    let batch = std::env::var("LUMIERE_PROJECTION_WORKER_BATCH")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(100u32);
    let finalization_batch = std::env::var("LUMIERE_FINALIZATION_WORKER_BATCH")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0 && *value <= 200)
        .unwrap_or(100u32);
    let port = std::env::var("LUMIERE_PROJECTION_WORKER_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8096u16);
    let state = Arc::new(AppState::new(config));
    let pg_config = pg_pool::PgConfig::from_env().context("PG config for projection worker")?;
    let pool = pg_pool::build_pool(&pg_config).context("build PG pool for projection worker")?;
    migrate::ensure_schema(&pool)
        .await
        .context("apply projection infrastructure schema")?;
    ensure_projection_relations(&pool, PROJECTION_CODEC_MANIFEST_JSON).await?;
    finalization_worker::parse_archive_manifest(finalization_worker::ARCHIVE_MANIFEST_JSON)
        .context("validate generated C5 archive manifest")?;

    let ready = Arc::new(AtomicBool::new(false));
    let worker_ready = ready.clone();
    let worker_state = state;
    let worker_pool = pool.clone();
    tokio::spawn(async move {
        loop {
            match drain_batch(&worker_state.stdb, &worker_pool, batch).await {
                Ok(stats) => {
                    let finalization = finalization_worker::drain_batch(
                        &worker_state.stdb,
                        &worker_pool,
                        finalization_batch,
                    )
                    .await;
                    let persisted_quarantine =
                        match projection_observability::read_projection_statuses(&worker_pool).await
                        {
                            Ok(statuses) => statuses.iter().any(|status| {
                                status.last_error.is_some() || status.quarantined_sequence.is_some()
                            }),
                            Err(error) => {
                                tracing::error!(
                                    %error,
                                    "read persisted projection readiness status failed"
                                );
                                true
                            }
                        };
                    let finalization_failed = match &finalization {
                        Ok(finalization_stats) => finalization_stats.failed > 0,
                        Err(error) => {
                            tracing::error!(%error, "manifest-driven C5 finalization batch failed");
                            true
                        }
                    };
                    worker_ready.store(
                        stats.failed == 0 && !persisted_quarantine && !finalization_failed,
                        Ordering::Relaxed,
                    );
                    if stats.commits > 0 || stats.already_applied > 0 {
                        tracing::info!(?stats, "projection worker batch complete");
                    }
                    if let Ok(finalization_stats) = finalization {
                        if finalization_stats.read > 0 {
                            tracing::info!(?finalization_stats, "C5 finalization batch complete");
                        }
                    }
                }
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "projection worker batch failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(poll_secs)).await;
        }
    });
    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route(
            "/status",
            get(move || {
                let status_pool = pool.clone();
                async move {
                    match projection_observability::read_projection_statuses(&status_pool).await {
                        Ok(statuses) => (StatusCode::OK, Json(statuses)).into_response(),
                        Err(error) => (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": error.to_string() })),
                        )
                            .into_response(),
                    }
                }
            }),
        )
        .route(
            "/health/ready",
            get(move || {
                let ready = ready.clone();
                async move {
                    if ready.load(Ordering::Relaxed) {
                        StatusCode::OK
                    } else {
                        StatusCode::SERVICE_UNAVAILABLE
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
    tracing::info!(port, "projection worker listening");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::decode::parse_commit;
    use super::relations::{parse_relations, render_relation_ddl};
    use super::status::{classify_apply_error, projection_heads, ProjectionFailureKind};
    use anyhow::anyhow;
    use serde_json::{json, Value};

    fn manifest() -> String {
        json!({
            "version": 1,
            "tables": {
                "parent": {
                    "projection_table": "parent",
                    "projection_mode": "upsert-current",
                    "primary_key": {"name": "id", "type": "U64"},
                    "organization_column": "organization_id",
                    "columns": [
                        {"name":"id", "pg_type":"NUMERIC(20,0)", "nullable":false},
                        {"name":"organization_id", "pg_type":"NUMERIC(20,0)", "nullable":false}
                    ]
                }
            }
        })
        .to_string()
    }

    #[test]
    fn parses_and_sorts_safe_projection_relations() {
        let relations = parse_relations(&manifest()).unwrap();
        assert_eq!(relations[0].table, "parent");
        assert_eq!(relations[0].primary_key, "id");
        assert_eq!(relations[0].organization_column, "organization_id");
    }

    #[test]
    fn renders_quoted_organization_projection_ddl() {
        let relation = parse_relations(&manifest()).unwrap().remove(0);
        let ddl = render_relation_ddl(&relation).unwrap();
        assert!(ddl.contains("CREATE TABLE IF NOT EXISTS \"parent\""));
        assert!(ddl.contains("\"organization_id\" NUMERIC(20,0) NOT NULL"));
        assert!(ddl.contains("PRIMARY KEY (\"id\")"));
        assert!(ddl.contains("CREATE INDEX IF NOT EXISTS \"parent_organization_id\""));
    }

    #[test]
    fn parses_commit_wire_shape_without_coercing_fields() {
        let row = json!({
            "id": "7:1",
            "organizationId": 7,
            "sequence": 1,
            "operationId": "erp.create_task",
            "correlationId": "request-1",
            "changeSchemaVersion": 1,
            "contractVersion": "ir-v2",
            "occurredAt": {"microsSinceUnixEpoch": 12},
            "actorIdentity": "0x".to_string() + &"ab".repeat(32),
            "rowChangeCount": 1,
            "checksum": "a".repeat(64)
        });
        let commit = parse_commit(&row).unwrap();
        assert_eq!(commit.organization_id, 7);
        assert_eq!(commit.sequence, 1);
        assert_eq!(commit.occurred_at_micros, 12);
        assert_eq!(commit.actor_identity_hex, "ab".repeat(32));
    }

    #[test]
    fn rejects_identifier_and_type_injection() {
        let mut value: Value = serde_json::from_str(&manifest()).unwrap();
        value["tables"]["parent"]["columns"][0]["pg_type"] =
            Value::String("TEXT; DROP TABLE parent".into());
        assert!(parse_relations(&value.to_string()).is_err());

        let mut value: Value = serde_json::from_str(&manifest()).unwrap();
        value["tables"]["parent"]["projection_table"] = Value::String("parent;drop".into());
        assert!(parse_relations(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_missing_or_unknown_projection_mode() {
        let mut value: Value = serde_json::from_str(&manifest()).unwrap();
        value["tables"]["parent"]
            .as_object_mut()
            .unwrap()
            .remove("projection_mode");
        assert!(parse_relations(&value.to_string()).is_err());

        value["tables"]["parent"]["projection_mode"] = Value::String("snapshot".into());
        assert!(parse_relations(&value.to_string()).unwrap().is_empty());

        value["tables"]["parent"]["projection_mode"] = Value::String("future-mode".into());
        assert!(parse_relations(&value.to_string()).is_err());
    }

    #[test]
    fn projection_heads_never_jump_over_expected_sequence() {
        assert_eq!(projection_heads(8, 4), (7, 3));
        assert_eq!(projection_heads(1, 1), (0, 0));
        assert_eq!(projection_heads(0, 9), (0, 8));
    }

    #[test]
    fn classifies_wrapped_validation_and_transport_failures() {
        let validation = anyhow!("apply commit failed").context("checksum mismatch");
        assert_eq!(
            classify_apply_error(&validation),
            ProjectionFailureKind::Quarantine
        );
        let immutable_history = anyhow!("apply commit failed")
            .context("append-history table does not accept delete changes");
        assert_eq!(
            classify_apply_error(&immutable_history),
            ProjectionFailureKind::Quarantine
        );
        let transport = anyhow!("apply commit failed").context("get PG client failed");
        assert_eq!(
            classify_apply_error(&transport),
            ProjectionFailureKind::Retryable
        );
    }
}
