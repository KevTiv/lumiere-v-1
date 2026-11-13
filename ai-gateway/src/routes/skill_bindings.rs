//! Read-only discovery of native adapters in this gateway build.
//! These templates confer no authority: certification and release recheck source,
//! tenant permissions, fixtures, environment and the active runtime profile.

use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::{harness, orchestrator::generation_surface_certification, state::AppState};

pub(crate) fn binding(skill_key: &str) -> Option<Value> {
    let (manifest, version, source_hash, permissions) = match skill_key {
        "report_analysis" => (
            harness::governed_llm_skills::report_analysis_manifest(),
            harness::certification::REPORT_ANALYSIS_CERTIFICATION_VERSION,
            harness::certification::report_analysis_certification_bundle_hash(),
            vec!["report:read"],
        ),
        "report_composer" => (
            harness::report_composer::manifest(),
            harness::report_composer::REPORT_COMPOSER_RELEASE_VERSION,
            harness::certification::report_composer_certification_bundle_hash(),
            vec!["report:read"],
        ),
        "low_stock" => (
            harness::low_stock::manifest(),
            harness::low_stock::LOW_STOCK_RELEASE_VERSION,
            harness::certification::low_stock_certification_bundle_hash(),
            vec!["inventory:read"],
        ),
        key if lumiere_finance_review_core::skill(key).is_ok() => (
            harness::finance_skills::manifest(key).ok()?,
            lumiere_finance_review_core::VERSION,
            harness::finance_skills::bundle_hash(key),
            vec![],
        ),
        key if generation_surface_certification::KEYS.contains(&key) => (
            generation_surface_certification::manifest(key).ok()?,
            generation_surface_certification::VERSION,
            generation_surface_certification::bundle_hash(key).ok()?,
            vec![],
        ),
        _ => return None,
    };
    Some(json!({
        "skillKey": skill_key,
        "adapterMajor": manifest.skill.version,
        "manifest": {
            "schema_version": 1,
            "skill_key": skill_key,
            "version": version,
            "source_hash": source_hash,
            "risk": manifest.risk,
            "permissions": permissions,
            "resources": manifest.named_resources,
            "output_types": [manifest.output_type],
            "limits": {
                "max_steps": manifest.limits.max_steps,
                "max_tool_calls": manifest.limits.max_tool_calls,
            },
        },
    }))
}

/// Mounted behind the gateway's internal-secret middleware. The web BFF also
/// requires an authenticated organization session. No provider calls or writes.
pub async fn get_bindings(State(state): State<AppState>) -> Json<Value> {
    let bindings: Vec<_> = [
        "report_analysis",
        "report_composer",
        "low_stock",
        "rag_generation",
        "form_suggestion",
        "action_draft_generation",
        "finance_report_review",
        "bank_reconciliation_review",
        "period_close_review",
        "expense_evidence_review",
        "finance_variance_review",
    ]
    .into_iter()
    .filter_map(binding)
    .collect();
    let certification_configured = state
        .config
        .ai_certification_stdb_token
        .as_ref()
        .is_some_and(|token| !token.trim().is_empty());
    Json(json!({
        "bindings": bindings,
        "runtimeHash": state.config.ai_certification_runtime_hash,
        "certificationConfigured": certification_configured,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_uses_the_current_executable_source_and_policy() {
        let report = binding("report_analysis").expect("native adapter");
        assert_eq!(
            report["manifest"]["source_hash"],
            harness::certification::report_analysis_certification_bundle_hash()
        );
        assert_eq!(report["manifest"]["skill_key"], "report_analysis");
        assert_eq!(
            report["manifest"]["output_types"][0],
            "analytics.report_analysis.result.v1"
        );
        assert!(binding("unregistered_code").is_none());
    }

    #[test]
    fn generation_discovery_binds_each_surface_to_its_own_executable_source() {
        for key in generation_surface_certification::KEYS {
            let discovered = binding(key).expect("supported generation source");
            let expected = generation_surface_certification::manifest(key).unwrap();
            assert_eq!(discovered["manifest"]["skill_key"], key);
            assert_eq!(
                discovered["manifest"]["version"],
                generation_surface_certification::VERSION
            );
            assert_eq!(
                discovered["manifest"]["source_hash"],
                generation_surface_certification::bundle_hash(key).unwrap()
            );
            assert_eq!(
                discovered["manifest"]["resources"],
                json!(expected.named_resources)
            );
            assert_eq!(
                discovered["manifest"]["output_types"],
                json!([expected.output_type])
            );
        }
        assert!(binding("unregistered_generation").is_none());
    }

    #[test]
    fn finance_discovery_uses_the_certification_revision() {
        let discovered = binding("finance_report_review").expect("finance adapter");
        assert_eq!(
            discovered["manifest"]["version"],
            lumiere_finance_review_core::VERSION
        );
    }
}
