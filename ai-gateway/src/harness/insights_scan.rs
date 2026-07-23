//! Green `insights_scan` skill — read-only anomaly detectors via named read.

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
    skills::{scan_insights, InsightsScanRequest, InsightsScanResult},
    state::AppState,
};

pub const INSIGHTS_SCAN_SKILL_KEY: &str = "insights_scan";
pub const INSIGHTS_SCAN_SKILL_VERSION: u32 = 1;
pub const INSIGHTS_SCAN_RESOURCE: &str = "analytics.insights_scan.v1";
pub const INSIGHTS_SCAN_OUTPUT_TYPE: &str = "analytics.insights_scan.result.v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InsightsScanInput {
    #[serde(default)]
    pub max_insights: Option<usize>,
    #[serde(default)]
    pub abnormal_amount_threshold: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsScanHarnessResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub scan: InsightsScanResult,
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
        skill: SkillVersionRef::new(INSIGHTS_SCAN_SKILL_KEY, INSIGHTS_SCAN_SKILL_VERSION),
        review: reviewed(),
        risk: RiskClass::Green,
        named_resources: vec![INSIGHTS_SCAN_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: INSIGHTS_SCAN_OUTPUT_TYPE.to_string(),
        limits: ExecutionLimits {
            max_rows: 100,
            max_steps: 1,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new([
            "created_count",
            "skipped_count",
            "candidate_count",
            "counts",
            "preview_insights",
            "warnings",
        ]),
    }
}

pub fn resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: INSIGHTS_SCAN_RESOURCE.to_string(),
        review: reviewed(),
        output_type: INSIGHTS_SCAN_OUTPUT_TYPE.to_string(),
        rows_field: "preview_insights".to_string(),
        validate_input,
        validate_output: |_| Ok(()),
    }
}

fn validate_input(value: &Value) -> Result<(), String> {
    let _: InsightsScanInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid insights_scan input: {error}"))?;
    Ok(())
}

pub async fn run_insights_scan(
    state: &AppState,
    organization_id: u64,
    identity_hex: &str,
    input: InsightsScanInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<InsightsScanHarnessResult, String> {
    let input_value = serde_json::to_value(&input).unwrap_or_default();
    validate_input(&input_value)?;

    let scan = scan_insights(
        state,
        InsightsScanRequest {
            org_id: organization_id,
            company_id: Some(company_id),
            max_insights: input.max_insights,
            abnormal_amount_threshold: input.abnormal_amount_threshold,
        },
    )
    .await;

    let outcome = execute_named_read(
        &policy,
        NamedReadRunArgs {
            skill_key: INSIGHTS_SCAN_SKILL_KEY,
            skill_version: INSIGHTS_SCAN_SKILL_VERSION,
            resource: INSIGHTS_SCAN_RESOURCE,
            output_type: INSIGHTS_SCAN_OUTPUT_TYPE,
            organization_id,
            company_id,
            identity_hex,
            input: input_value,
            candidate_output: serde_json::to_value(&scan).unwrap_or_default(),
            expected_rows: scan.preview_insights.len() as u32,
            steps: 1,
            audit_label: "insights_scan",
        },
    );

    if !outcome.allowed {
        return Ok(InsightsScanHarnessResult {
            decision: outcome.decision,
            summary: String::new(),
            scan: empty_scan(),
            audit: outcome.audit.into_trail(),
        });
    }

    let mut audit = outcome.audit;
    let summary = if scan.preview_insights.is_empty() {
        "No insight candidates were found for the selected scope.".to_string()
    } else {
        format!(
            "Found {} insight candidate(s) across {} detector group(s).",
            scan.preview_insights.len(),
            scan.counts.len()
        )
    };
    audit.record("artifact", "insights scan summary composed");
    audit.record("completed", "insights_scan succeeded");

    Ok(InsightsScanHarnessResult {
        decision: outcome.decision,
        summary,
        scan,
        audit: audit.into_trail(),
    })
}

fn empty_scan() -> InsightsScanResult {
    InsightsScanResult {
        created_count: 0,
        skipped_count: 0,
        candidate_count: 0,
        counts: Vec::new(),
        preview_insights: Vec::new(),
        persisted: false,
        warnings: Vec::new(),
    }
}
