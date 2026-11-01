//! Reconcile deployment-owned service identities onto active tenants.
//!
//! Only public identities belong in this configuration. Worker credentials stay
//! on their own services. This runs with the API's existing administrator client,
//! independently of signup, so existing tenants and interrupted provisioning are
//! retried too. Existing bindings (including retired ones) are never replaced.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use anyhow::{ensure, Context, Result};
use serde::Deserialize;
use serde_json::json;
use stdb_client::{normalize_spacetime_identity_header, ReducerCall, StdbClient};

use crate::{organization_placement::OrganizationPlacementResolver, state::AppState};

pub(crate) const CONFIG_ENV: &str = "LUMIERE_TENANT_SERVICE_IDENTITIES";
const SCAN_LIMIT: usize = 10_000;
const SCAN_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct TenantServices(BTreeMap<String, String>);

impl TenantServices {
    pub(crate) fn parse(value: &str) -> Result<Self> {
        let configured: BTreeMap<String, String> = serde_json::from_str(value)
            .with_context(|| format!("{CONFIG_ENV} must be a JSON object"))?;
        ensure!(
            !configured.is_empty(),
            "{CONFIG_ENV} must select at least one service"
        );
        let mut identities: BTreeMap<String, String> = BTreeMap::new();
        for (service, value) in configured {
            ensure!(
                matches!(
                    service.as_str(),
                    "projection_worker"
                        | "pos_order_hydrator"
                        | "workflow_worker"
                        | "owner_report_worker"
                        | "expense_integration_worker"
                        | "hr_integration_worker"
                        | "project_integration_worker"
                ),
                "{CONFIG_ENV} contains an unsupported service"
            );
            let identity = normalize_spacetime_identity_header(&value)
                .filter(|identity| identity.bytes().any(|byte| byte != b'0'))
                .with_context(|| format!("{CONFIG_ENV} contains an invalid public identity"))?;
            for (other_service, other_identity) in &identities {
                ensure!(
                    other_identity != &identity || projection_pair(&service, other_service),
                    "tenant services must use distinct identities"
                );
            }
            identities.insert(service, identity);
        }
        Ok(Self(identities))
    }
}

fn projection_pair(left: &str, right: &str) -> bool {
    matches!(
        (left, right),
        ("projection_worker", "pos_order_hydrator") | ("pos_order_hydrator", "projection_worker")
    )
}

/// Start only in the API process, never in a worker or public request handler.
pub(crate) fn start(state: Arc<AppState>) -> Result<()> {
    let Some(value) = std::env::var(CONFIG_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(());
    };
    let services = TenantServices::parse(&value)?;
    ensure!(
        state.config.stdb_server_token.is_some(),
        "tenant enrollment requires STDB_SERVER_TOKEN"
    );
    tokio::spawn(async move {
        loop {
            if let Err(error) = reconcile(&state.stdb, &services, |organization_id| {
                state
                    .organization_placements
                    .resolve(organization_id)
                    .is_ok_and(|placement| placement.lifecycle().permits_business_execution())
            })
            .await
            {
                tracing::error!(%error, "tenant service enrollment failed; will retry");
            }
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });
    Ok(())
}

#[derive(Deserialize)]
struct OrganizationRow {
    id: u64,
}

#[derive(Deserialize)]
struct BindingRow {
    #[serde(alias = "organizationId")]
    organization_id: u64,
    identity: serde_json::Value,
    #[serde(alias = "isActive")]
    is_active: bool,
}

impl BindingRow {
    fn identity(&self) -> Option<String> {
        self.identity
            .as_str()
            .or_else(|| {
                self.identity
                    .get("__identity__")
                    .and_then(serde_json::Value::as_str)
            })
            .and_then(normalize_spacetime_identity_header)
    }
}

async fn reconcile(
    client: &StdbClient,
    services: &TenantServices,
    permits: impl Fn(u64) -> bool,
) -> Result<()> {
    let client = client.with_query_limits(SCAN_LIMIT, SCAN_BYTES)?;
    let administrator = client.authenticated_identity().await?;
    ensure!(
        !services
            .0
            .values()
            .any(|identity| identity == &administrator),
        "tenant service identity must differ from the administrator"
    );
    let organizations = client
        .query_sql("SELECT id FROM organization WHERE is_active = true")
        .await?
        .into_iter()
        .map(serde_json::from_value::<OrganizationRow>)
        .collect::<Result<Vec<_>, _>>()?;
    ensure!(
        organizations.iter().all(|row| row.id > 0),
        "invalid tenant identity"
    );
    let mut failures = 0;
    for (service, identity) in &services.0 {
        let history = client.query_sql(&format!(
            "SELECT organization_id, identity, is_active FROM cold_tier_service_identity WHERE service_name = '{service}'"
        )).await?.into_iter().map(serde_json::from_value::<BindingRow>).collect::<Result<Vec<_>, _>>()?;
        for organization in &organizations {
            if !permits(organization.id) {
                continue;
            }
            let bindings: Vec<_> = history
                .iter()
                .filter(|row| row.organization_id == organization.id)
                .collect();
            if !bindings.is_empty() {
                let active: Vec<_> = bindings.iter().filter(|row| row.is_active).collect();
                // A retired binding is an operator decision, not missing setup.
                if !active.is_empty()
                    && (active.len() != 1 || active[0].identity().as_ref() != Some(identity))
                {
                    tracing::error!(organization_id = organization.id, service,
                        "tenant service binding differs from deployment; operator rotation required");
                    failures += 1;
                }
                continue;
            }
            let result = enroll(&client, organization.id, service, identity).await;
            if let Err(error) = result {
                failures += 1;
                tracing::error!(organization_id = organization.id, service, %error,
                    "tenant service enrollment failed");
            }
        }
    }
    ensure!(
        failures == 0,
        "{failures} tenant service enrollments require attention"
    );
    Ok(())
}

async fn enroll(
    client: &StdbClient,
    organization_id: u64,
    service: &str,
    identity: &str,
) -> Result<()> {
    // Stable across retries and API replicas, independent of the identity. The
    // registry rejects reuse for a different identity instead of rotating it.
    let platform_id = format!("tenant-enrollment-{service}-{organization_id}");
    client
        .call_reducer(ReducerCall::from_name(
            "register_cold_tier_service_identity",
            json!([
                organization_id, platform_id, service, {"__identity__": format!("0x{identity}")}
            ]),
        )?)
        .await?;
    let rows = client.query_sql(&format!(
        "SELECT organization_id, identity, is_active FROM cold_tier_service_identity \
         WHERE organization_id = {organization_id} AND service_name = '{service}' AND is_active = true"
    )).await?.into_iter().map(serde_json::from_value::<BindingRow>).collect::<Result<Vec<_>, _>>()?;
    ensure!(
        rows.len() == 1
            && rows[0].organization_id == organization_id
            && rows[0].is_active
            && rows[0].identity().as_deref() == Some(identity),
        "tenant service enrollment readback failed"
    );
    tracing::info!(organization_id, service, "tenant service enrolled");
    Ok(())
}

#[cfg(test)]
mod tests;
