//! Fail-closed verification for organization-scoped SpacetimeDB service bindings.

use anyhow::{bail, Context, Result};
use serde_json::Value;
use stdb_client::{normalize_spacetime_identity_header, StdbClient};

/// Service binding used by the C5 projection/finalization worker.
pub const PROJECTION_WORKER_SERVICE: &str = "projection_worker";
pub const OWNER_REPORT_WORKER_SERVICE: &str = "owner_report_worker";
pub const WORKFLOW_WORKER_SERVICE: &str = "workflow_worker";
pub const EXPENSE_WORKER_SERVICE: &str = "expense_integration_worker";
pub const HR_WORKER_SERVICE: &str = "hr_integration_worker";
pub const PROJECT_WORKER_SERVICE: &str = "project_integration_worker";

/// Verify that the configured token is the active registered identity for one
/// organization and service name. The token's response identity is the only
/// authority; no JWT payload or caller-supplied identity is trusted.
pub async fn verify_registered_service_identity(
    stdb: &StdbClient,
    organization_id: u64,
    service_name: &str,
) -> Result<()> {
    if organization_id == 0 {
        bail!("organization_id must be non-zero");
    }
    validate_service_name(service_name)?;
    let authenticated_identity = stdb
        .authenticated_identity()
        .await
        .context("verify SpacetimeDB service identity")?;
    let rows = stdb
        .query_sql(&format!(
            "SELECT organization_id, service_name, identity, is_active \
             FROM cold_tier_service_identity \
             WHERE organization_id = {organization_id} \
             AND service_name = '{service_name}' AND is_active = true"
        ))
        .await
        .context("read organization service identity binding")?;
    if rows.len() != 1 {
        bail!(
            "expected exactly one active {service_name} binding for organization {organization_id}"
        );
    }
    let row = &rows[0];
    if row
        .get("organizationId")
        .or_else(|| row.get("organization_id"))
        .and_then(as_u64)
        != Some(organization_id)
        || row
            .get("serviceName")
            .or_else(|| row.get("service_name"))
            .and_then(Value::as_str)
            != Some(service_name)
        || row
            .get("isActive")
            .or_else(|| row.get("is_active"))
            .and_then(Value::as_bool)
            != Some(true)
    {
        bail!("active service identity binding is malformed");
    }
    let registered_identity = row
        .get("identity")
        .and_then(identity_from_value)
        .context("service identity binding lacks identity")?;
    if registered_identity != authenticated_identity {
        bail!("configured token is not the registered service identity");
    }
    Ok(())
}

fn validate_service_name(service_name: &str) -> Result<()> {
    if service_name.is_empty()
        || service_name.len() > 128
        || !service_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        bail!("service_name must contain only bounded ASCII service-name characters");
    }
    Ok(())
}

fn identity_from_value(value: &Value) -> Option<String> {
    let raw = value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str))?;
    normalize_spacetime_identity_header(raw)
}

fn as_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::{identity_from_value, validate_service_name};
    use serde_json::json;

    const IDENTITY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn service_identity_values_require_canonical_hex() {
        assert_eq!(
            identity_from_value(&json!(IDENTITY)).as_deref(),
            Some(IDENTITY)
        );
        assert_eq!(
            identity_from_value(&json!({"__identity__": format!("0x{IDENTITY}")})).as_deref(),
            Some(IDENTITY)
        );
        assert!(identity_from_value(&json!("not-an-identity")).is_none());
    }

    #[test]
    fn service_names_are_sql_safe_and_bounded() {
        assert!(validate_service_name("projection_worker").is_ok());
        assert!(validate_service_name("worker' OR true").is_err());
        assert!(validate_service_name(&"x".repeat(129)).is_err());
    }
}
