//! Green `import_mapping` skill — CSV mapping analyze/preview via named read.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{
    audit::PolicyResult,
    audit_logger::HarnessAuditTrail,
    data_scope_resolver::NamedResourceContract,
    manifest::{
        Capability, ExecutionLimits, PrivacyPolicy, ReviewMetadata, ReviewStatus, RiskClass,
        SkillManifest, SkillVersionRef,
    },
    named_read_run::{execute_named_read, NamedReadRunArgs, NAMED_READ_TOOL},
    policy_engine::PolicyEngine,
};
use crate::skills::{
    analyze_import_mapping, parse_csv_text, preview_import_mapping, ImportAnalyzeRequest,
    ImportPreviewRequest,
};

pub const IMPORT_MAPPING_SKILL_KEY: &str = "import_mapping";
pub const IMPORT_MAPPING_SKILL_VERSION: u32 = 1;
pub const IMPORT_MAPPING_RESOURCE: &str = "data.import_mapping.v1";
pub const IMPORT_MAPPING_OUTPUT_TYPE: &str = "data.import_mapping.result.v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ImportMappingInput {
    pub target_entity: String,
    #[serde(default)]
    pub csv_text: Option<String>,
    #[serde(default)]
    pub headers: Option<Vec<String>>,
    #[serde(default)]
    pub sample_rows: Option<Vec<Vec<String>>>,
    #[serde(default)]
    pub mapping: Option<Map<String, Value>>,
    #[serde(default)]
    pub prior_mappings: Option<Map<String, Value>>,
    #[serde(default)]
    pub bundle_key: Option<String>,
    #[serde(default)]
    pub max_rows: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMappingResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub payload: Value,
    pub audit: HarnessAuditTrail,
}

fn reviewed() -> ReviewMetadata {
    ReviewMetadata {
        status: ReviewStatus::Promoted,
        reviewed_by: "legacy-migration".to_string(),
        reviewed_at: "2026-07-23T00:00:00Z".to_string(),
    }
}

pub fn manifest() -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(IMPORT_MAPPING_SKILL_KEY, IMPORT_MAPPING_SKILL_VERSION),
        review: reviewed(),
        risk: RiskClass::Green,
        named_resources: vec![IMPORT_MAPPING_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: IMPORT_MAPPING_OUTPUT_TYPE.to_string(),
        limits: ExecutionLimits {
            max_rows: 500,
            max_steps: 1,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new([
            "target_entity",
            "headers",
            "mappings",
            "warnings",
            "validation_errors",
            "rows",
        ]),
    }
}

pub fn resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: IMPORT_MAPPING_RESOURCE.to_string(),
        review: reviewed(),
        output_type: IMPORT_MAPPING_OUTPUT_TYPE.to_string(),
        rows_field: "mappings".to_string(),
        validate_input,
        validate_output: |_| Ok(()),
    }
}

fn validate_input(value: &Value) -> Result<(), String> {
    let input: ImportMappingInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid import_mapping input: {error}"))?;
    if input.target_entity.trim().is_empty() {
        return Err("target_entity is required".to_string());
    }
    Ok(())
}

pub fn run_import_mapping(
    organization_id: u64,
    identity_hex: &str,
    input: ImportMappingInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<ImportMappingResult, String> {
    let input_value = serde_json::to_value(&input).unwrap_or_default();
    validate_input(&input_value)?;
    let payload = compute_import_mapping(&input)?;
    let expected_rows = payload
        .get("mappings")
        .or_else(|| payload.get("rows"))
        .and_then(Value::as_array)
        .map(|rows| rows.len() as u32)
        .unwrap_or(1);

    let outcome = execute_named_read(
        &policy,
        NamedReadRunArgs {
            skill_key: IMPORT_MAPPING_SKILL_KEY,
            skill_version: IMPORT_MAPPING_SKILL_VERSION,
            resource: IMPORT_MAPPING_RESOURCE,
            output_type: IMPORT_MAPPING_OUTPUT_TYPE,
            organization_id,
            company_id,
            identity_hex,
            input: input_value,
            candidate_output: payload.clone(),
            expected_rows,
            steps: 1,
            audit_label: "import_mapping",
        },
    );

    if !outcome.allowed {
        return Ok(ImportMappingResult {
            decision: outcome.decision,
            summary: String::new(),
            payload: Value::Null,
            audit: outcome.audit.into_trail(),
        });
    }

    let mut audit = outcome.audit;
    let summary = if payload.get("error").is_some() {
        "Import mapping failed validation.".to_string()
    } else if payload.get("mappings").is_some() {
        "Suggested CSV column mappings are ready for review.".to_string()
    } else {
        "Import mapping preview is ready for review.".to_string()
    };
    audit.record("artifact", "import mapping result composed");
    audit.record("completed", "import_mapping succeeded");

    Ok(ImportMappingResult {
        decision: outcome.decision,
        summary,
        payload,
        audit: audit.into_trail(),
    })
}

fn compute_import_mapping(input: &ImportMappingInput) -> Result<Value, String> {
    let target_entity = input.target_entity.trim();
    if target_entity.is_empty() {
        return Err("target_entity is required".to_string());
    }

    let (headers, sample_rows) = if let Some(csv_text) = input
        .csv_text
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        parse_csv_text(csv_text)?
    } else {
        let headers = input
            .headers
            .clone()
            .filter(|headers| !headers.is_empty())
            .ok_or_else(|| "headers or csv_text is required".to_string())?;
        (headers, input.sample_rows.clone().unwrap_or_default())
    };

    if let Some(mapping) = &input.mapping {
        let preview = preview_import_mapping(ImportPreviewRequest {
            target_entity: target_entity.to_string(),
            headers,
            rows: input.sample_rows.clone().unwrap_or(sample_rows),
            mapping: mapping.clone(),
            max_rows: input.max_rows,
        })?;
        return Ok(serde_json::to_value(preview).unwrap_or_default());
    }

    let analyze = analyze_import_mapping(ImportAnalyzeRequest {
        target_entity: target_entity.to_string(),
        headers,
        sample_rows,
        prior_mappings: input.prior_mappings.clone().unwrap_or_default(),
        bundle_key: input.bundle_key.clone(),
    })?;
    Ok(serde_json::to_value(analyze).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        data_scope_resolver::ResourceRegistry, skill_registry::SkillRegistry,
    };

    #[test]
    fn analyzes_product_headers() {
        let policy = PolicyEngine::new(
            SkillRegistry::exact(manifest()),
            ResourceRegistry::built_in(),
        );
        let result = run_import_mapping(
            1,
            "tester",
            ImportMappingInput {
                target_entity: "product".to_string(),
                csv_text: None,
                headers: Some(vec![
                    "Product Name".to_string(),
                    "SKU".to_string(),
                    "Sales Price".to_string(),
                ]),
                sample_rows: Some(Vec::new()),
                mapping: None,
                prior_mappings: None,
                bundle_key: None,
                max_rows: None,
            },
            1,
            policy,
        )
        .expect("run");
        assert_ne!(
            result.decision.decision.outcome,
            crate::harness::audit::DecisionOutcome::Deny,
            "reasons={:?}",
            result.decision.decision.reasons
        );
        assert!(result.payload.get("mappings").is_some());
    }
}
