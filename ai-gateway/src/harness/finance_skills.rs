//! Finance skill adapters. Tenant promotion remains independent of code registration.
use super::{data_scope_resolver::NamedResourceContract, manifest::*};
use lumiere_finance_review_core::{self as core, Skill};
use serde_json::Value;

pub const TOOL: &str = "finance_review_read";
pub const FORMAT:&str="Evidence-cited finance review: preserve exact currency, cutoff, source limitations and incomplete coverage. Separate facts from hypotheses. Never approve or execute a financial action.";

fn reviewed() -> ReviewMetadata {
    ReviewMetadata {
        status: ReviewStatus::Promoted,
        reviewed_by: "compiled-finance-read-contract-v1".into(),
        reviewed_at: "2026-10-26T00:00:00Z".into(),
    }
}
pub fn manifest(key: &str) -> Result<SkillManifest, String> {
    let spec = core::skill(key).map_err(|e| e.to_string())?;
    Ok(SkillManifest {
        skill: SkillVersionRef::new(key, 1),
        review: reviewed(),
        risk: RiskClass::Green,
        named_resources: vec![spec.resource.into()],
        allowed_tools: vec![TOOL.into(), "named_resource_read".into()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: spec.output.into(),
        limits: ExecutionLimits {
            max_rows: 1_000,
            max_steps: 5,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new(["summary", "artifacts", "citations", "steps"]),
    })
}

fn validate(key: &str, value: &Value) -> Result<(), String> {
    let mut input = if value.get("inputs").is_some() {
        serde_json::from_value::<super::governed_llm_skills::GovernedLlmSkillInput>(value.clone())
            .map_err(|e| e.to_string())?
            .inputs
    } else {
        value.clone()
    };
    // These fields are introduced by the server-owned knowledge compiler after
    // initial input validation. They are evidence, never read parameters.
    if let Some(object) = input.as_object_mut() {
        for key in [
            "referenceKnowledge",
            "referenceKnowledgeUnavailable",
            "referenceKnowledgeNote",
        ] {
            object.remove(key);
        }
    }
    core::parse_input(key, &input)
        .map(|_| ())
        .map_err(|e| e.to_string())
}
macro_rules! validator {
    ($name:ident,$key:literal) => {
        fn $name(v: &Value) -> Result<(), String> {
            validate($key, v)
        }
    };
}
validator!(report, "finance_report_review");
validator!(bank, "bank_reconciliation_review");
validator!(close, "period_close_review");
validator!(expense, "expense_evidence_review");
validator!(variance, "finance_variance_review");

pub fn resource_contract(spec: Skill) -> NamedResourceContract {
    let validate_input: super::data_scope_resolver::ContractValidator = match spec.key {
        "finance_report_review" => report,
        "bank_reconciliation_review" => bank,
        "period_close_review" => close,
        "expense_evidence_review" => expense,
        _ => variance,
    };
    NamedResourceContract {
        name: spec.resource.into(),
        review: reviewed(),
        output_type: spec.output.into(),
        rows_field: "artifacts".into(),
        validate_input,
        validate_output: |value| {
            if value.is_object() {
                Ok(())
            } else {
                Err("finance output must be an object".into())
            }
        },
    }
}

pub fn bundle_hash(key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"lumiere.finance.skill.compiled.v1\0");
    hash.update(key.as_bytes());
    // Bind the common executor, admission, persistence and answer-gate sources
    // as well as this skill's domain projection and prompt.
    hash.update(super::certification::report_analysis_certification_bundle_hash().as_bytes());
    for part in [
        include_bytes!("finance_skills.rs").as_slice(),
        include_bytes!("finance_review/mod.rs").as_slice(),
        include_bytes!("../tools/finance_review.rs").as_slice(),
        include_bytes!("../orchestrator/governed_programs.rs").as_slice(),
        include_bytes!("../orchestrator/candidate_certification.rs").as_slice(),
        include_bytes!("../../../crates/finance-review-core/src/lib.rs").as_slice(),
        include_bytes!("../../../crates/finance-review-core/src/reviews.rs").as_slice(),
        include_bytes!("../../../api-server/src/routes/finance_reviews.rs").as_slice(),
        include_bytes!("../../../api-server/src/document_blobs.rs").as_slice(),
        include_bytes!("../../../api-server/src/evidence_ingestion.rs").as_slice(),
        include_bytes!("../../../api-server/src/reports/common.rs").as_slice(),
        include_bytes!("../../../api-server/src/reports/service/financial.rs").as_slice(),
        include_bytes!("../../../api-server/src/reports/open_balances.rs").as_slice(),
        include_bytes!("../../../api-server/src/reports/financial_position.rs").as_slice(),
        include_bytes!("../../../api-server/src/reports/auth.rs").as_slice(),
        include_bytes!("../../../crates/stdb-client/src/lib.rs").as_slice(),
        include_bytes!("release_registry.rs").as_slice(),
        include_bytes!("data_scope_resolver.rs").as_slice(),
        include_bytes!("certification.rs").as_slice(),
    ] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part);
    }
    let prompt: &[u8] = match key {
        "finance_report_review" => {
            include_bytes!("../../../erp-skills/finance_report_review/SKILL.md")
        }
        "bank_reconciliation_review" => {
            include_bytes!("../../../erp-skills/bank_reconciliation_review/SKILL.md")
        }
        "period_close_review" => include_bytes!("../../../erp-skills/period_close_review/SKILL.md"),
        "expense_evidence_review" => {
            include_bytes!("../../../erp-skills/expense_evidence_review/SKILL.md")
        }
        "finance_variance_review" => {
            include_bytes!("../../../erp-skills/finance_variance_review/SKILL.md")
        }
        _ => b"unsupported",
    };
    hash.update(prompt);
    format!("sha256:{:x}", hash.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_finance_manifest_matches_its_compiled_adapter_and_read_contract() {
        for spec in core::SKILLS {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
                "../infra/skill-releases/finance/{}.proposed.json",
                spec.key
            ));
            let proposed: Value =
                serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            assert_eq!(proposed["source_hash"], bundle_hash(spec.key));
            assert_eq!(proposed["version"], core::VERSION);
            let manifest = manifest(spec.key).unwrap();
            assert_eq!(manifest.allowed_capabilities, vec![Capability::NamedRead]);
            assert_eq!(manifest.limits.max_tool_calls, 1);
            assert!(
                crate::orchestrator::governed_programs::governed_program_for_skill(spec.key)
                    .is_some()
            );
        }
    }
    #[test]
    fn finance_input_contracts_reject_wrong_workflow_and_scope_override() {
        for spec in core::SKILLS {
            assert!((resource_contract(spec).validate_input)(
                &serde_json::json!({"companyId":9,"statementId":1})
            )
            .is_err());
            assert!((resource_contract(spec).validate_input)(
                &serde_json::json!({"sql":"SELECT *"})
            )
            .is_err());
        }
    }
}
