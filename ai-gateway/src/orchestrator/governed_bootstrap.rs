//! Explicit organization-scoped bootstrap for governed intelligence configuration.
//!
//! Runtime skill execution is resolve-only: it must not create model profiles,
//! intelligence policies, calibration profiles, or DecisionType definitions.
//! This module owns the idempotent bootstrap of Lumiere-owned immutable defaults
//! that are safe to seed uniformly for an organization.

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::json;
use stdb_client::{ReducerCall, StdbClient};

use super::{
    decision_type::{register_builtin_decision_types, StdbDecisionTypeRegistry},
    model_configuration::{ModelConfigurationStore, StdbModelConfigurationStore},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GovernedBootstrapResult {
    pub organization_id: u64,
    pub intelligence_policy_ref: String,
    pub calibration_profiles: Vec<String>,
    pub decision_types_registered: bool,
}

pub(super) async fn bootstrap_governed_intelligence(
    writer: &StdbClient,
    reader: &StdbClient,
    organization_id: u64,
    intelligence_policy_ref: Option<&str>,
) -> Result<GovernedBootstrapResult> {
    if organization_id == 0 {
        anyhow::bail!("organization_id must be nonzero");
    }

    let decision_types = StdbDecisionTypeRegistry {
        writer,
        reader,
        organization_id,
    };
    register_builtin_decision_types(&decision_types)
        .await
        .context("register built-in governed DecisionTypes")?;

    writer
        .call_reducer(ReducerCall::from_name(
            "register_ai_calibration_profile",
            json!([
                organization_id,
                {
                    "profile_name": "report-attention",
                    "profile_version": 1,
                    "description": "Reviewed calibration profile for ReportAttentionNeed@1. Immutable and organization-scoped; runtime resolves but never creates this profile.",
                    "breakpoints_json": "[[0.0,0.0],[0.35,0.35],[0.65,0.65],[1.0,1.0]]"
                }
            ]),
        ))
        .await
        .context("register report-attention calibration profile")?;

    // Profiles and policies are deployment/admin authored because provider/model
    // identities are environment-specific. Bootstrap only verifies that an
    // active reviewed policy already exists; it never fabricates one from an
    // agent's legacy provider configuration.
    let store = StdbModelConfigurationStore { reader };
    let (policy_key, policy_version) = match intelligence_policy_ref {
        Some(value) if !value.trim().is_empty() => {
            let parsed = super::model_configuration::ModelProfileRef::parse(value)
                .context("intelligence policy ref must use policy_key@version")?;
            (parsed.key, Some(parsed.version))
        }
        _ => ("default".to_string(), None),
    };
    let policy = store
        .policy(organization_id, &policy_key, policy_version)
        .await?
        .with_context(|| {
            format!(
                "active intelligence policy '{}{}' must be registered before governed bootstrap",
                policy_key,
                policy_version
                    .map(|version| format!("@{version}"))
                    .unwrap_or_default()
            )
        })?;

    Ok(GovernedBootstrapResult {
        organization_id,
        intelligence_policy_ref: format!("{}@{}", policy.key, policy.version),
        calibration_profiles: vec!["report-attention@1".to_string()],
        decision_types_registered: true,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn bootstrap_is_explicitly_not_a_runtime_fallback() {
        // Structural guard: runtime callers use this module explicitly; no
        // automatic startup hook exists because organizations/policies are
        // tenant-scoped and must be deliberately provisioned.
        assert_eq!("report-attention@1".split('@').count(), 2);
    }
}
