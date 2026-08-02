//! Policy-gated harness adapters for LLM-backed bundled skills.
//!
//! After release + NamedRead policy succeed, execution continues through
//! `run_skill_unlocked` so tool/LLM behavior stays shared with the legacy body.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
use crate::{
    orchestrator::run::{run_skill_unlocked, RunSkillOverrides, RunSkillRequest, RunSkillResponse},
    state::AppState,
};

pub const REPORT_ANALYSIS_SKILL_KEY: &str = "report_analysis";
pub const PROCESS_RESEARCH_SKILL_KEY: &str = "process_research";
pub const PRICE_SEARCH_SKILL_KEY: &str = "price_search";
pub const SUPPLIER_DISCOVERY_SKILL_KEY: &str = "supplier_discovery";
pub const LLM_BUNDLED_SKILL_VERSION: u32 = 1;

pub const REPORT_ANALYSIS_RESOURCE: &str = "analytics.report_analysis.v1";
pub const PROCESS_RESEARCH_RESOURCE: &str = "operations.process_research.v1";
pub const PRICE_SEARCH_RESOURCE: &str = "procurement.price_search.v1";
pub const SUPPLIER_DISCOVERY_RESOURCE: &str = "procurement.supplier_discovery.v1";

pub const REPORT_ANALYSIS_OUTPUT_TYPE: &str = "analytics.report_analysis.result.v1";
pub const PROCESS_RESEARCH_OUTPUT_TYPE: &str = "operations.process_research.result.v1";
pub const PRICE_SEARCH_OUTPUT_TYPE: &str = "procurement.price_search.result.v1";
pub const SUPPLIER_DISCOVERY_OUTPUT_TYPE: &str = "procurement.supplier_discovery.result.v1";

const LLM_PRIVACY_FIELDS: &[&str] = &["summary", "artifacts", "citations", "steps"];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GovernedLlmSkillInput {
    #[serde(default)]
    pub inputs: Value,
    #[serde(default)]
    pub agent_id: Option<u64>,
    #[serde(default)]
    pub team_member_id: Option<u64>,
    #[serde(default)]
    pub max_steps: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernedLlmSkillResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub run: Option<RunSkillResponse>,
    pub audit: HarnessAuditTrail,
}

struct SkillEndpoints {
    resource: &'static str,
    output_type: &'static str,
}

fn reviewed() -> ReviewMetadata {
    ReviewMetadata {
        status: ReviewStatus::Promoted,
        reviewed_by: "legacy-migration".to_string(),
        reviewed_at: "2026-07-23T00:00:00Z".to_string(),
    }
}

fn endpoints(skill_key: &str) -> Result<SkillEndpoints, String> {
    let endpoints = match skill_key {
        REPORT_ANALYSIS_SKILL_KEY => SkillEndpoints {
            resource: REPORT_ANALYSIS_RESOURCE,
            output_type: REPORT_ANALYSIS_OUTPUT_TYPE,
        },
        PROCESS_RESEARCH_SKILL_KEY => SkillEndpoints {
            resource: PROCESS_RESEARCH_RESOURCE,
            output_type: PROCESS_RESEARCH_OUTPUT_TYPE,
        },
        PRICE_SEARCH_SKILL_KEY => SkillEndpoints {
            resource: PRICE_SEARCH_RESOURCE,
            output_type: PRICE_SEARCH_OUTPUT_TYPE,
        },
        SUPPLIER_DISCOVERY_SKILL_KEY => SkillEndpoints {
            resource: SUPPLIER_DISCOVERY_RESOURCE,
            output_type: SUPPLIER_DISCOVERY_OUTPUT_TYPE,
        },
        other => return Err(format!("unknown governed LLM skill '{other}'")),
    };
    Ok(endpoints)
}

fn green_manifest(skill_key: &str, resource: &str, output_type: &str) -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(skill_key, LLM_BUNDLED_SKILL_VERSION),
        review: reviewed(),
        risk: RiskClass::Green,
        named_resources: vec![resource.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: output_type.to_string(),
        limits: ExecutionLimits {
            max_rows: 200,
            max_steps: 8,
            max_tool_calls: 12,
        },
        privacy: PrivacyPolicy::new(LLM_PRIVACY_FIELDS.iter().copied()),
    }
}

fn resource_contract(name: &str, output_type: &str) -> NamedResourceContract {
    NamedResourceContract {
        name: name.to_string(),
        review: reviewed(),
        output_type: output_type.to_string(),
        rows_field: "artifacts".to_string(),
        validate_input: validate_llm_input,
        validate_output: |_| Ok(()),
    }
}

fn validate_llm_input(value: &Value) -> Result<(), String> {
    let _: GovernedLlmSkillInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid governed LLM skill input: {error}"))?;
    Ok(())
}

pub fn report_analysis_manifest() -> SkillManifest {
    green_manifest(
        REPORT_ANALYSIS_SKILL_KEY,
        REPORT_ANALYSIS_RESOURCE,
        REPORT_ANALYSIS_OUTPUT_TYPE,
    )
}

pub fn process_research_manifest() -> SkillManifest {
    green_manifest(
        PROCESS_RESEARCH_SKILL_KEY,
        PROCESS_RESEARCH_RESOURCE,
        PROCESS_RESEARCH_OUTPUT_TYPE,
    )
}

pub fn price_search_manifest() -> SkillManifest {
    green_manifest(
        PRICE_SEARCH_SKILL_KEY,
        PRICE_SEARCH_RESOURCE,
        PRICE_SEARCH_OUTPUT_TYPE,
    )
}

pub fn supplier_discovery_manifest() -> SkillManifest {
    green_manifest(
        SUPPLIER_DISCOVERY_SKILL_KEY,
        SUPPLIER_DISCOVERY_RESOURCE,
        SUPPLIER_DISCOVERY_OUTPUT_TYPE,
    )
}

pub fn report_analysis_resource_contract() -> NamedResourceContract {
    resource_contract(REPORT_ANALYSIS_RESOURCE, REPORT_ANALYSIS_OUTPUT_TYPE)
}

pub fn process_research_resource_contract() -> NamedResourceContract {
    resource_contract(PROCESS_RESEARCH_RESOURCE, PROCESS_RESEARCH_OUTPUT_TYPE)
}

pub fn price_search_resource_contract() -> NamedResourceContract {
    resource_contract(PRICE_SEARCH_RESOURCE, PRICE_SEARCH_OUTPUT_TYPE)
}

pub fn supplier_discovery_resource_contract() -> NamedResourceContract {
    resource_contract(SUPPLIER_DISCOVERY_RESOURCE, SUPPLIER_DISCOVERY_OUTPUT_TYPE)
}

pub async fn run_governed_llm_skill(
    state: &AppState,
    skill_key: &str,
    organization_id: u64,
    identity_hex: &str,
    stdb_token: &str,
    input: GovernedLlmSkillInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<GovernedLlmSkillResult, String> {
    let SkillEndpoints {
        resource,
        output_type,
    } = endpoints(skill_key)?;
    let input_value = serde_json::to_value(&input).unwrap_or_default();
    validate_llm_input(&input_value)?;

    let outcome = execute_named_read(
        &policy,
        NamedReadRunArgs {
            skill_key,
            skill_version: LLM_BUNDLED_SKILL_VERSION,
            resource,
            output_type,
            organization_id,
            company_id,
            identity_hex,
            input: input_value,
            candidate_output: json!({
                "summary": "",
                "artifacts": [],
                "citations": [],
                "steps": [],
            }),
            expected_rows: 1,
            steps: input.max_steps.unwrap_or(5).max(1),
            audit_label: skill_key,
        },
    );

    if !outcome.allowed {
        return Ok(GovernedLlmSkillResult {
            decision: outcome.decision,
            summary: String::new(),
            run: None,
            audit: outcome.audit.into_trail(),
        });
    }

    let mut audit = outcome.audit;
    let run = run_skill_unlocked(
        state,
        RunSkillRequest {
            org_id: organization_id,
            company_id,
            skill_key: skill_key.to_string(),
            inputs: input.inputs,
            agent_id: input.agent_id,
            team_member_id: input.team_member_id,
            triggered_by_hex: Some(identity_hex.to_string()),
            stdb_token: Some(stdb_token.to_string()),
            overrides: input.max_steps.map(|max_steps| RunSkillOverrides {
                max_steps: Some(max_steps),
            }),
        },
    )
    .await
    .map_err(|error| error.to_string())?;

    audit.record("artifact", format!("{skill_key} run completed"));
    audit.record("completed", format!("{skill_key} succeeded"));

    Ok(GovernedLlmSkillResult {
        decision: outcome.decision,
        summary: run.summary.clone(),
        run: Some(run),
        audit: audit.into_trail(),
    })
}
