//! Shared serve/poll/readiness lifecycle for the expense, HR, and project integration workers.
//!
//! Each domain worker supplies an [`IntegrationWorkerSpec`] with its env-var prefix,
//! default health port, canonical reducer name, and log label. This module owns the
//! common lifecycle: env-var parsing, AppState setup, the bounded poll loop, health
//! routes, and the TCP listener. Domain-specific reducer dispatch stays explicit in
//! the spec — this module does not absorb workflow outbox or projection workers.

use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{http::StatusCode, routing::get, Router};
use serde_json::{json, Value};
use stdb_client::{ReducerCall, StdbClient};

use crate::{
    config::Config,
    organization_placement::{
        ConfiguredPlacementResolver, OrganizationPlacementResolver, PlacementGeneration,
    },
    state::AppState,
};

/// Configuration for a domain integration worker.
pub struct IntegrationWorkerSpec {
    /// Env-var prefix, e.g. `"EXPENSE"`, `"HR"`, `"PROJECT"`.
    pub env_prefix: &'static str,
    /// Default health-check port if the env var is unset.
    pub default_port: u16,
    /// Canonical reducer name, e.g. `"apply_pending_expense_integration_intents"`.
    pub reducer_name: &'static str,
    /// Organization-scoped service binding required by this worker token.
    pub service_name: &'static str,
    /// Human-readable label used in tracing output.
    pub log_label: &'static str,
}

/// Authorized context for one organization-scoped scheduled service.
///
/// The context owns a clone of the worker client so callers cannot accidentally
/// dispatch a scheduled reducer through the API session or server client. Each
/// operation is checked against the generated reducer contract before it is
/// sent, and the organization argument is bound to the identity verification
/// performed by [`Self::authorize`].
#[derive(Clone)]
pub(crate) struct ScheduledService {
    client: StdbClient,
    organization_id: u64,
    service_name: &'static str,
    placement_generation: PlacementGeneration,
    placements: ConfiguredPlacementResolver,
}

impl ScheduledService {
    pub(crate) async fn authorize(
        state: &AppState,
        organization_id: u64,
        service_name: &'static str,
    ) -> anyhow::Result<Self> {
        crate::service_identity::verify_registered_service_identity(
            &state.stdb,
            organization_id,
            service_name,
        )
        .await?;
        let placement = state
            .organization_placements
            .resolve(organization_id)
            .map_err(|error| anyhow::anyhow!("resolve scheduled service placement: {error}"))?;
        if !placement.lifecycle().permits_business_execution() {
            return Err(anyhow::anyhow!(
                "organization placement is fenced for scheduled service execution"
            ));
        }
        Ok(Self {
            client: state.stdb.clone(),
            organization_id,
            service_name,
            placement_generation: placement.generation(),
            placements: state.organization_placements.clone(),
        })
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn service_name(&self) -> &'static str {
        self.service_name
    }

    pub(crate) fn client(&self) -> &StdbClient {
        &self.client
    }

    /// Call one generated-contract reducer under this service's tenant scope.
    pub(crate) async fn call(&self, reducer: &str, args: Value) -> anyhow::Result<()> {
        let current = self
            .placements
            .resolve(self.organization_id)
            .map_err(|error| anyhow::anyhow!("resolve scheduled service placement: {error}"))?;
        if current.generation() != self.placement_generation
            || !current.lifecycle().permits_business_execution()
        {
            return Err(anyhow::anyhow!(
                "scheduled service placement is stale or fenced"
            ));
        }
        if !self.permits(reducer) {
            return Err(anyhow::anyhow!(
                "scheduled service '{}' cannot invoke reducer '{reducer}'",
                self.service_name
            ));
        }
        let contract = stdb_client::reducer_contract(reducer).ok_or_else(|| {
            anyhow::anyhow!("scheduled reducer '{reducer}' is absent from the contract")
        })?;
        validate_scheduled_operation_scope(contract, &args, self.organization_id)?;
        let operation_id = contract.contract_operation_id;
        let call = ReducerCall::from_name(contract.name, args)
            .map_err(|error| anyhow::anyhow!("validate {operation_id}: {error}"))?;
        tracing::debug!(
            operation_id,
            organization_id = self.organization_id,
            service = self.service_name(),
            "dispatching scheduled service operation"
        );
        self.client.call_reducer(call).await?;
        Ok(())
    }

    fn permits(&self, reducer: &str) -> bool {
        service_permits(self.service_name, reducer)
    }
}

fn service_permits(service_name: &str, reducer: &str) -> bool {
    match service_name {
        crate::service_identity::OWNER_REPORT_WORKER_SERVICE => matches!(
            reducer,
            "dispatch_due_owner_reports"
                | "claim_queue_job"
                | "complete_queue_job"
                | "fail_scheduled_owner_report_run"
                | "complete_scheduled_owner_report_run"
                | "worker_heartbeat"
                | "register_queue_worker"
                | "record_generated_owner_report"
        ),
        crate::service_identity::WORKFLOW_WORKER_SERVICE => matches!(
            reducer,
            "claim_queue_job"
                | "complete_queue_job"
                | "worker_heartbeat"
                | "register_queue_worker"
                | "fire_workflow_timer"
                | "record_workflow_outbox_result"
        ),
        crate::service_identity::EXPENSE_WORKER_SERVICE => {
            reducer == "apply_pending_expense_integration_intents"
        }
        crate::service_identity::HR_WORKER_SERVICE => {
            reducer == "apply_pending_hr_integration_intents"
        }
        crate::service_identity::PROJECT_WORKER_SERVICE => {
            reducer == "apply_pending_project_integration_intents"
        }
        _ => false,
    }
}

fn validate_scheduled_operation_scope(
    contract: &'static stdb_client::ReducerContract,
    args: &Value,
    organization_id: u64,
) -> anyhow::Result<()> {
    let position = contract.organization_position.ok_or_else(|| {
        anyhow::anyhow!(
            "scheduled reducer '{}' is not organization-scoped",
            contract.name
        )
    })?;
    let args_array = args.as_array().ok_or_else(|| {
        anyhow::anyhow!(
            "scheduled reducer '{}' arguments must be an array",
            contract.name
        )
    })?;
    let actual = args_array
        .get(position)
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "scheduled reducer '{}' organization argument is invalid",
                contract.name
            )
        })?;
    if actual != organization_id {
        return Err(anyhow::anyhow!(
            "scheduled reducer '{}' organization scope mismatch",
            contract.name
        ));
    }
    Ok(())
}

/// Start a bounded polling worker and its internal health endpoint.
pub async fn serve(spec: IntegrationWorkerSpec) -> anyhow::Result<()> {
    let config = Config::from_worker_env()?;
    let token_env = format!("STDB_{}_WORKER_TOKEN", spec.env_prefix);
    let worker_token = config.require_dedicated_worker_token(&token_env)?;
    let port = std::env::var(format!("LUMIERE_{}_WORKER_PORT", spec.env_prefix))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(spec.default_port);
    let poll_secs = std::env::var(format!("LUMIERE_{}_WORKER_POLL_SECS", spec.env_prefix))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(15u64);
    let batch = std::env::var(format!("LUMIERE_{}_WORKER_BATCH", spec.env_prefix))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20u32);
    let org_ids = std::env::var(format!("LUMIERE_{}_WORKER_ORG_IDS", spec.env_prefix))
        .unwrap_or_default()
        .split(',')
        .filter_map(|s| s.trim().parse::<u64>().ok())
        .collect::<Vec<_>>();

    let mut app_state = AppState::new(config);
    app_state.stdb = app_state.stdb.with_token(worker_token);
    let state = Arc::new(app_state);
    // Configuration alone does not prove that the SpacetimeDB dependency and
    // reducer are reachable. Readiness becomes true only after one successful
    // batch, matching the other API-server workers.
    let ready = Arc::new(AtomicBool::new(false));
    let worker_state = state.clone();
    let worker_ready = ready.clone();
    let orgs = org_ids.clone();
    let reducer_name = spec.reducer_name;
    let service_name = spec.service_name;
    let log_label = spec.log_label;
    let env_prefix = spec.env_prefix;
    tokio::spawn(async move {
        if orgs.is_empty() {
            tracing::warn!("{log_label} idle: set LUMIERE_{env_prefix}_WORKER_ORG_IDS");
            return;
        }
        loop {
            match process_batch(&worker_state, &orgs, batch, reducer_name, service_name).await {
                Ok(_) => worker_ready.store(true, Ordering::Relaxed),
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "{log_label} batch failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(poll_secs)).await;
        }
    });

    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route(
            "/health/ready",
            get(move || {
                let ready = ready.clone();
                async move { readiness_status(ready.load(Ordering::Relaxed)) }
            }),
        );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
    tracing::info!(port, "{log_label} listening");
    axum::serve(listener, app).await?;
    Ok(())
}

fn readiness_status(ready: bool) -> StatusCode {
    if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

async fn process_batch(
    state: &AppState,
    org_ids: &[u64],
    batch: u32,
    reducer_name: &str,
    service_name: &'static str,
) -> anyhow::Result<()> {
    for organization_id in org_ids {
        let service = ScheduledService::authorize(state, *organization_id, service_name).await?;
        service
            .call(reducer_name, json!([organization_id, batch]))
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{readiness_status, service_permits, validate_scheduled_operation_scope};
    use axum::http::StatusCode;

    #[test]
    fn integration_worker_is_unready_until_a_batch_succeeds() {
        assert_eq!(readiness_status(false), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(readiness_status(true), StatusCode::OK);
    }

    #[test]
    fn scheduled_service_rejects_unscoped_or_cross_tenant_operations() {
        let contract = stdb_client::reducer_contract("worker_heartbeat").expect("contract");
        assert_eq!(contract.organization_position, Some(0));
        assert!(
            validate_scheduled_operation_scope(contract, &serde_json::json!([7, 505]), 7).is_ok()
        );
        assert!(
            validate_scheduled_operation_scope(contract, &serde_json::json!([8, 505]), 7).is_err()
        );
        let unscoped = stdb_client::reducer_contract("apply_global_migrations").expect("contract");
        assert!(validate_scheduled_operation_scope(unscoped, &serde_json::json!([]), 7).is_err());
    }

    #[test]
    fn scheduled_service_operation_allowlists_are_identity_specific() {
        assert!(service_permits(
            crate::service_identity::OWNER_REPORT_WORKER_SERVICE,
            "claim_queue_job"
        ));
        assert!(!service_permits(
            crate::service_identity::OWNER_REPORT_WORKER_SERVICE,
            "apply_pending_hr_integration_intents"
        ));
    }
}
