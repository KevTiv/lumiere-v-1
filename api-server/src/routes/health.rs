//! Process liveness, dependency readiness, and Prometheus metrics.

use crate::cold_tier::{commit_projection, migrate, pg_pool, projection_observability};
use crate::{metrics, state::AppState};
use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    Json,
};
use serde::Serialize;
use std::{future::Future, sync::Arc, time::Duration};

const STDB_READINESS_TIMEOUT: Duration = Duration::from_secs(3);
const RELEASE_MANIFEST_JSON: &str = include_str!("../../../release-compatibility-manifest.json");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadinessComponent {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

impl ReadinessComponent {
    fn new(status: &'static str, detail: Option<String>) -> Self {
        Self { status, detail }
    }

    fn healthy() -> Self {
        Self::new("healthy", None)
    }

    fn unhealthy(detail: impl Into<String>) -> Self {
        Self::new("unhealthy", Some(detail.into()))
    }

    fn unavailable(detail: impl Into<String>) -> Self {
        Self::new("unavailable", Some(detail.into()))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadinessComponents {
    spacetime_db: ReadinessComponent,
    postgres: ReadinessComponent,
    projection_lag: ReadinessComponent,
    contract_version: ReadinessComponent,
    migration: ReadinessComponent,
    release_compatibility: ReadinessComponent,
    ai: ReadinessComponent,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadinessReport {
    status: &'static str,
    release_id: String,
    contract_version: &'static str,
    contract_release: String,
    migration_version: Option<i64>,
    expected_migration_version: i64,
    components: ReadinessComponents,
}

#[derive(Debug)]
struct ReleaseMetadata {
    contract_release: String,
    contract_version: String,
    migration_version: i64,
}

pub(crate) async fn health() -> StatusCode {
    StatusCode::OK
}

pub(crate) async fn health_ready(
    State(state): State<Arc<AppState>>,
) -> (StatusCode, HeaderMap, Json<ReadinessReport>) {
    let token = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|token| !token.is_empty())
        .unwrap_or("");
    let client = state.client_with_token(token);
    let (postgres_result, stdb_result) = tokio::join!(
        pg_pool::check_ready_with_grace(Duration::from_secs(
            state.config.projection_lag_budget_secs,
        )),
        check_stdb_ready(&client, STDB_READINESS_TIMEOUT)
    );

    let spacetime_db = match &stdb_result {
        Ok(()) => ReadinessComponent::healthy(),
        Err(error) => {
            tracing::warn!(%error, "SpacetimeDB readiness probe failed");
            ReadinessComponent::unhealthy("SpacetimeDB readiness probe failed")
        }
    };
    let mut migration_version = None;
    let (postgres, projection_lag, migration) = match postgres_result {
        Ok(false) => match pg_pool::required_pool() {
            Ok(pool) => {
                let (migration_result, projection_result) = tokio::join!(
                    migrate::check_schema_ready(pool),
                    projection_observability::read_projection_statuses(pool)
                );
                let migration = match migration_result {
                    Ok(version) => {
                        migration_version = Some(version);
                        ReadinessComponent::healthy()
                    }
                    Err(error) => {
                        tracing::warn!(%error, "migration readiness probe failed");
                        ReadinessComponent::unhealthy("migration history is incompatible")
                    }
                };
                let projection = match projection_result {
                    Ok(statuses) => {
                        projection_component(&statuses, state.config.projection_lag_budget_secs)
                    }
                    Err(error) => {
                        tracing::warn!(%error, "projection readiness probe failed");
                        ReadinessComponent::unhealthy("projection status is unavailable")
                    }
                };
                (ReadinessComponent::healthy(), projection, migration)
            }
            Err(error) => {
                tracing::warn!(%error, "PostgreSQL readiness configuration failed");
                unavailable_postgres_components("PostgreSQL readiness failed")
            }
        },
        Ok(true) => (
            ReadinessComponent::new(
                "degraded",
                Some("PostgreSQL is inside the bounded outage grace; cooling is disabled".into()),
            ),
            ReadinessComponent::unavailable(
                "projection status unavailable during PostgreSQL outage",
            ),
            ReadinessComponent::unavailable(
                "migration status unavailable during PostgreSQL outage",
            ),
        ),
        Err(error) => {
            tracing::warn!(%error, "PostgreSQL readiness probe failed");
            unavailable_postgres_components("PostgreSQL readiness failed")
        }
    };

    let dependencies_ready = stdb_result.is_ok()
        && matches!(postgres.status, "healthy" | "degraded")
        && matches!(projection_lag.status, "healthy" | "unavailable")
        && matches!(migration.status, "healthy" | "unavailable");
    let degraded = postgres.status == "degraded";
    readiness_response(
        dependencies_ready,
        degraded,
        spacetime_db,
        postgres,
        projection_lag,
        migration,
        migration_version,
    )
}

fn unavailable_postgres_components(
    detail: &str,
) -> (ReadinessComponent, ReadinessComponent, ReadinessComponent) {
    (
        ReadinessComponent::unhealthy(detail),
        ReadinessComponent::unavailable(detail),
        ReadinessComponent::unavailable(detail),
    )
}

fn readiness_response(
    dependencies_ready: bool,
    degraded: bool,
    spacetime_db: ReadinessComponent,
    postgres: ReadinessComponent,
    projection_lag: ReadinessComponent,
    migration: ReadinessComponent,
    migration_version: Option<i64>,
) -> (StatusCode, HeaderMap, Json<ReadinessReport>) {
    let release = release_metadata();
    let (contract_release, contract_version, release_migration, release_compatibility) =
        match release {
            Ok(release) => {
                let compatible = release.contract_version == commit_projection::CONTRACT_VERSION
                    && migration_version.is_none_or(|version| version == release.migration_version);
                let component = if compatible {
                    ReadinessComponent::healthy()
                } else {
                    ReadinessComponent::unhealthy(
                        "binary, contract, and migration versions disagree",
                    )
                };
                (
                    release.contract_release,
                    release.contract_version,
                    release.migration_version,
                    component,
                )
            }
            Err(error) => (
                "unknown".to_owned(),
                "unknown".to_owned(),
                0,
                ReadinessComponent::unhealthy(error),
            ),
        };
    let contract_component = if contract_version == commit_projection::CONTRACT_VERSION {
        ReadinessComponent::healthy()
    } else {
        ReadinessComponent::unhealthy(format!(
            "release requires {contract_version}, binary uses {}",
            commit_projection::CONTRACT_VERSION
        ))
    };
    let ready = dependencies_ready && release_compatibility.status == "healthy";
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let mut headers = HeaderMap::new();
    if degraded && ready {
        headers.insert("x-lumiere-degraded", HeaderValue::from_static("postgres"));
    }
    let report = ReadinessReport {
        status: if ready {
            if degraded {
                "degraded"
            } else {
                "ready"
            }
        } else {
            "unready"
        },
        release_id: format!("api-server/{}", env!("CARGO_PKG_VERSION")),
        contract_version: commit_projection::CONTRACT_VERSION,
        contract_release,
        migration_version,
        expected_migration_version: release_migration,
        components: ReadinessComponents {
            spacetime_db,
            postgres,
            projection_lag,
            contract_version: contract_component,
            migration,
            release_compatibility,
            ai: ReadinessComponent::new(
                "informational",
                Some("AI availability does not gate ordinary ERP".into()),
            ),
        },
    };
    (status, headers, Json(report))
}

fn projection_component(
    statuses: &[projection_observability::ProjectionStatus],
    lag_budget_secs: u64,
) -> ReadinessComponent {
    let organizations = statuses
        .iter()
        .filter(|status| {
            status.last_error.is_some()
                || status.quarantined_sequence.is_some()
                || !status.within_lag_budget(lag_budget_secs)
        })
        .map(|status| status.organization_id)
        .collect::<Vec<_>>();
    if organizations.is_empty() {
        ReadinessComponent::healthy()
    } else {
        ReadinessComponent::unhealthy(format!(
            "projection unhealthy for organizations {}",
            organizations
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(",")
        ))
    }
}

fn release_metadata() -> Result<ReleaseMetadata, String> {
    let manifest: serde_json::Value = serde_json::from_str(RELEASE_MANIFEST_JSON)
        .map_err(|error| format!("parse release compatibility manifest: {error}"))?;
    let required_string = |pointer: &str| {
        manifest
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| format!("release manifest is missing {pointer}"))
    };
    let migration_version = manifest
        .pointer("/durable_postgres/application_catalog_version")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| {
            "release manifest is missing /durable_postgres/application_catalog_version".to_owned()
        })?;
    Ok(ReleaseMetadata {
        contract_release: required_string("/lumiere_contracts/version")?,
        contract_version: required_string("/stdb_module/contract_version")?,
        migration_version,
    })
}

async fn check_stdb_ready(
    client: &stdb_client::StdbClient,
    timeout: Duration,
) -> anyhow::Result<()> {
    bounded_probe(
        timeout,
        client.query_sql("SELECT * FROM organization WHERE id = 0"),
    )
    .await
    .map_err(|_| anyhow::anyhow!("SpacetimeDB readiness probe timed out"))??;
    Ok(())
}

async fn bounded_probe<T>(
    timeout: Duration,
    probe: impl Future<Output = T>,
) -> Result<T, tokio::time::error::Elapsed> {
    tokio::time::timeout(timeout, probe).await
}

pub(crate) async fn metrics_handler() -> (StatusCode, String) {
    (StatusCode::OK, metrics::render_prometheus())
}

#[cfg(test)]
mod tests {
    use super::{bounded_probe, check_stdb_ready, projection_component, release_metadata};
    use crate::cold_tier::projection_observability::ProjectionStatus;
    use std::time::Duration;

    #[tokio::test]
    async fn readiness_probe_is_bounded() {
        let error = bounded_probe(Duration::from_millis(1), std::future::pending::<()>())
            .await
            .unwrap_err();
        let _: tokio::time::error::Elapsed = error;
    }

    #[tokio::test]
    async fn stdb_unavailable_readiness_fails_closed() {
        let client = stdb_client::StdbClient::new(
            "not-a-url".into(),
            "missing-module".into(),
            "token".into(),
        );
        assert!(check_stdb_ready(&client, Duration::from_millis(100))
            .await
            .is_err());
    }

    #[test]
    fn release_manifest_matches_runtime_contract_and_migrations() {
        let release = release_metadata().expect("valid release metadata");
        assert_eq!(release.contract_version, "ir-v2");
        assert_eq!(release.migration_version, 10);
        assert_eq!(release.contract_release, "0.3.39");
    }

    #[test]
    fn projection_health_names_unhealthy_organizations() {
        let status = ProjectionStatus {
            organization_id: 42,
            stdb_head_sequence: 2,
            durable_sequence: 1,
            backlog_commits: 1,
            oldest_unprojected_at: Some(1),
            oldest_unprojected_age_seconds: Some(61),
            last_error: None,
            quarantined_sequence: None,
        };
        let component = projection_component(&[status], 60);
        assert_eq!(component.status, "unhealthy");
        assert!(component
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("42")));
    }
}
