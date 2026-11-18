//! Read-only discovery of repository-owned skills in this gateway build.
//! Deployment supplies their executable policy; they have no tenant
//! certification/activation lifecycle. Permissions and enablement still apply.

use axum::Json;
use serde_json::{json, Value};

use crate::{harness, orchestrator::generation_surface_certification};

pub(crate) fn binding(skill_key: &str) -> Option<Value> {
    let manifest = match skill_key {
        "report_analysis" => harness::governed_llm_skills::report_analysis_manifest(),
        "report_composer" => harness::report_composer::manifest(),
        "low_stock" => harness::low_stock::manifest(),
        key if lumiere_finance_review_core::skill(key).is_ok() => {
            harness::finance_skills::manifest(key).ok()?
        }
        key if generation_surface_certification::KEYS.contains(&key) => {
            generation_surface_certification::manifest(key).ok()?
        }
        _ => return None,
    };
    Some(json!({
        "skillKey": skill_key,
        "adapterMajor": manifest.skill.version,
        "managedBy": "application",
        "certificationRequired": false,
        "activationRequired": false,
        "policy": {
            "risk": manifest.risk,
            "resources": manifest.named_resources,
            "outputTypes": [manifest.output_type],
            "limits": {
                "maxSteps": manifest.limits.max_steps,
                "maxToolCalls": manifest.limits.max_tool_calls,
            },
        },
    }))
}

/// Mounted behind the gateway's internal-secret middleware. The web BFF also
/// requires an authenticated organization session. No provider calls or writes.
pub async fn get_bindings() -> Json<Value> {
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
    Json(json!({
        "bindings": bindings,
        "managedBy": "application",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn application_skills_do_not_advertise_tenant_publication_manifests() {
        let report = binding("report_analysis").expect("native adapter");
        assert_eq!(report["managedBy"], "application");
        assert_eq!(report["certificationRequired"], false);
        assert_eq!(report["activationRequired"], false);
        assert!(report.get("manifest").is_none());
        assert_eq!(
            report["policy"]["outputTypes"][0],
            "analytics.report_analysis.result.v1"
        );
        assert!(binding("unregistered_code").is_none());
    }

    #[test]
    fn generation_discovery_uses_deployed_policy_without_source_activation() {
        for key in generation_surface_certification::KEYS {
            let discovered = binding(key).expect("supported generation source");
            let expected = generation_surface_certification::manifest(key).unwrap();
            assert_eq!(discovered["skillKey"], key);
            assert_eq!(discovered["certificationRequired"], false);
            assert_eq!(discovered["activationRequired"], false);
            assert_eq!(
                discovered["policy"]["resources"],
                json!(expected.named_resources)
            );
            assert_eq!(
                discovered["policy"]["outputTypes"],
                json!([expected.output_type])
            );
        }
        assert!(binding("unregistered_generation").is_none());
    }

    #[test]
    fn finance_discovery_needs_no_tenant_release_version() {
        for skill in lumiere_finance_review_core::SKILLS {
            let discovered = binding(skill.key).expect("supported Finance source");
            assert_eq!(
                discovered["adapterMajor"],
                harness::finance_skills::manifest(skill.key)
                    .unwrap()
                    .skill
                    .version
            );
            assert!(discovered.get("manifest").is_none());
            assert_eq!(discovered["activationRequired"], false);
        }
    }
}
