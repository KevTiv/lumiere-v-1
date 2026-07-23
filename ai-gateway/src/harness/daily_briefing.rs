//! Green `daily_briefing` skill — activity context via named read.

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    rig_agent::RigContext,
    skills::{collect_briefing_context, BriefingContext, BriefingContextRequest},
};

pub const DAILY_BRIEFING_SKILL_KEY: &str = "daily_briefing";
pub const DAILY_BRIEFING_SKILL_VERSION: u32 = 1;
pub const DAILY_BRIEFING_RESOURCE: &str = "operations.daily_briefing.v1";
pub const DAILY_BRIEFING_OUTPUT_TYPE: &str = "operations.daily_briefing.result.v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DailyBriefingInput {
    #[serde(default)]
    pub since_micros: Option<i64>,
    #[serde(default)]
    pub until_micros: Option<i64>,
    #[serde(default)]
    pub allowed_modules: Vec<String>,
    #[serde(default)]
    pub activity_query: Option<String>,
    #[serde(default)]
    pub top_k: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBriefingResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub briefing: BriefingContext,
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
        skill: SkillVersionRef::new(DAILY_BRIEFING_SKILL_KEY, DAILY_BRIEFING_SKILL_VERSION),
        review: reviewed(),
        risk: RiskClass::Green,
        named_resources: vec![DAILY_BRIEFING_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: DAILY_BRIEFING_OUTPUT_TYPE.to_string(),
        limits: ExecutionLimits {
            max_rows: 50,
            max_steps: 1,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new([
            "summary_md",
            "sections",
            "sources",
            "activity_query",
            "source_count",
        ]),
    }
}

pub fn resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: DAILY_BRIEFING_RESOURCE.to_string(),
        review: reviewed(),
        output_type: DAILY_BRIEFING_OUTPUT_TYPE.to_string(),
        rows_field: "sources".to_string(),
        validate_input,
        validate_output: |_| Ok(()),
    }
}

fn validate_input(value: &Value) -> Result<(), String> {
    let _: DailyBriefingInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid daily_briefing input: {error}"))?;
    Ok(())
}

pub async fn run_daily_briefing(
    rig: &RigContext,
    organization_id: u64,
    identity_hex: &str,
    input: DailyBriefingInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<DailyBriefingResult, String> {
    let input_value = serde_json::to_value(&input).unwrap_or_default();
    validate_input(&input_value)?;

    let briefing = collect_briefing_context(
        rig,
        BriefingContextRequest {
            org_id: organization_id,
            company_id: Some(company_id),
            since_micros: input.since_micros,
            until_micros: input.until_micros,
            allowed_modules: input.allowed_modules.clone(),
            activity_query: input.activity_query.clone(),
            top_k: input.top_k,
        },
    )
    .await;

    let outcome = execute_named_read(
        &policy,
        NamedReadRunArgs {
            skill_key: DAILY_BRIEFING_SKILL_KEY,
            skill_version: DAILY_BRIEFING_SKILL_VERSION,
            resource: DAILY_BRIEFING_RESOURCE,
            output_type: DAILY_BRIEFING_OUTPUT_TYPE,
            organization_id,
            company_id,
            identity_hex,
            input: input_value,
            candidate_output: serde_json::to_value(&briefing).unwrap_or_default(),
            expected_rows: briefing.source_count as u32,
            steps: 1,
            audit_label: "daily_briefing",
        },
    );

    if !outcome.allowed {
        return Ok(DailyBriefingResult {
            decision: outcome.decision,
            summary: String::new(),
            briefing: empty_briefing(),
            audit: outcome.audit.into_trail(),
        });
    }

    let mut audit = outcome.audit;
    let summary = briefing.summary_md.clone();
    audit.record("artifact", "daily briefing composed");
    audit.record("completed", "daily_briefing succeeded");

    Ok(DailyBriefingResult {
        decision: outcome.decision,
        summary,
        briefing,
        audit: audit.into_trail(),
    })
}

fn empty_briefing() -> BriefingContext {
    BriefingContext {
        summary_md: String::new(),
        sections: Vec::new(),
        sources: Vec::new(),
        activity_query: String::new(),
        source_count: 0,
    }
}
