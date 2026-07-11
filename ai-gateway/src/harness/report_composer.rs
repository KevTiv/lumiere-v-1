//! Green `report_composer` skill — Phase 1 owner-report summary.
//!
//! The skill accepts a catalog report key + scope, fetches the typed preview from
//! the Rust api-server using the caller's SpacetimeDB token, runs it through the
//! policy engine, and returns a short natural-language-style summary with
//! citations and a privacy report.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    audit::{DecisionOutcome, PolicyResult},
    audit_logger::{HarnessAuditLogger, HarnessAuditTrail},
    data_scope_resolver::NamedResourceContract,
    manifest::{
        Capability, ExecutionLimits, PrivacyPolicy, ReviewMetadata, ReviewStatus, RiskClass,
        SkillManifest, SkillVersionRef,
    },
    policy_engine::{
        ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyControlledRequest, PolicyEngine,
        PolicyExecutionRequest,
    },
};

pub const REPORT_COMPOSER_SKILL_KEY: &str = "report_composer";
pub const REPORT_COMPOSER_SKILL_VERSION: u32 = 1;
pub const REPORT_COMPOSER_RESOURCE: &str = "reports.daily_business_summary.v1";
pub const REPORT_COMPOSER_OUTPUT_TYPE: &str = "reports.daily_business_summary.summary.v1";
pub const NAMED_READ_TOOL: &str = "named_resource_read";

const PREVIEWABLE_REPORT_KEY: &str = "daily_business_summary_v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReportComposerInput {
    pub report_key: String,
    pub company_id: u64,
    pub date: String,
    pub timezone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReportSummaryItem {
    pub company_id: u64,
    pub label: String,
    pub value_minor_units: i64,
    pub currency_id: u64,
    pub scale: u8,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReportComposerOutput {
    pub report_key: String,
    pub title: String,
    pub items: Vec<ReportSummaryItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportComposerResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub citations: Vec<ReportCitation>,
    pub audit: HarnessAuditTrail,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportCitation {
    pub source: String,
    pub label: String,
    pub value_minor_units: i64,
}

pub fn manifest() -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(REPORT_COMPOSER_SKILL_KEY, REPORT_COMPOSER_SKILL_VERSION),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "phase1-policy".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        },
        risk: RiskClass::Green,
        named_resources: vec![REPORT_COMPOSER_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: REPORT_COMPOSER_OUTPUT_TYPE.to_string(),
        limits: ExecutionLimits {
            max_rows: 20,
            max_steps: 1,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new([
            "company_id",
            "label",
            "value_minor_units",
            "currency_id",
            "scale",
        ]),
    }
}

pub fn resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: REPORT_COMPOSER_RESOURCE.to_string(),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "phase1-policy".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        },
        output_type: REPORT_COMPOSER_OUTPUT_TYPE.to_string(),
        rows_field: "items".to_string(),
        validate_input,
        validate_output,
    }
}

fn validate_input(value: &Value) -> Result<(), String> {
    let input: ReportComposerInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid report-composer input: {error}"))?;
    if input.report_key != PREVIEWABLE_REPORT_KEY {
        return Err(format!(
            "report '{}' is not previewable in Phase 1",
            input.report_key
        ));
    }
    if input.company_id == 0 {
        return Err("company_id must be greater than zero".to_string());
    }
    if input.date.is_empty() {
        return Err("date is required".to_string());
    }
    if input.timezone.is_empty() {
        return Err("timezone is required".to_string());
    }
    Ok(())
}

fn validate_output(value: &Value) -> Result<(), String> {
    let output: ReportComposerOutput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid report-composer output: {error}"))?;
    if output.items.is_empty() {
        return Err("report-composer output must contain at least one summary item".to_string());
    }
    Ok(())
}

/// Fetch the typed report preview from the api-server and run it through the
/// policy engine. `stdb_token` is the end-user token used to authorize the
/// preview request.
pub async fn compose_report(
    http: &reqwest::Client,
    api_server_url: &str,
    organization_id: u64,
    identity_hex: &str,
    stdb_token: &str,
    input: ReportComposerInput,
    policy: PolicyEngine,
) -> Result<ReportComposerResult, String> {
    let correlation_id = uuid::Uuid::new_v4().to_string();
    let mut audit = HarnessAuditLogger::new(correlation_id.clone());
    audit.record(
        "requested",
        format!(
            "report_composer org={organization_id} company={} report={}",
            input.company_id, input.report_key
        ),
    );

    let preview = fetch_report_preview(http, api_server_url, stdb_token, &input).await?;
    audit.record("resource_accessed", "typed owner-report preview fetched");

    let output = build_composer_output(&input.report_key, input.company_id, &preview)?;
    audit.record(
        "candidate_output",
        format!("composed {} summary items", output.items.len()),
    );

    let request = PolicyControlledRequest {
        execution: PolicyExecutionRequest {
            skill: SkillVersionRef::new(REPORT_COMPOSER_SKILL_KEY, REPORT_COMPOSER_SKILL_VERSION),
            organization_id,
            company_id: input.company_id,
            correlation_id: correlation_id.clone(),
            metadata: ExecutionMetadata {
                actor_id: Some(identity_hex.to_string()),
                causation_id: Some(correlation_id),
                ..Default::default()
            },
            input: serde_json::to_value(&input).unwrap_or_default(),
            plan: ExecutionPlan {
                named_resources: vec![REPORT_COMPOSER_RESOURCE.to_string()],
                tool_calls: vec![PlannedToolCall {
                    tool_name: NAMED_READ_TOOL.to_string(),
                    capability: Capability::NamedRead,
                    named_resource: Some(REPORT_COMPOSER_RESOURCE.to_string()),
                }],
                steps: 1,
                expected_rows: output.items.len() as u32,
                output_type: REPORT_COMPOSER_OUTPUT_TYPE.to_string(),
            },
        },
        candidate_output: serde_json::to_value(&output).unwrap_or_default(),
    };

    let decision = policy.execute_controlled(request);
    audit.record(
        "policy",
        format!(
            "outcome={:?} reasons={}",
            decision.decision.outcome,
            decision.decision.reasons.len()
        ),
    );

    if decision.decision.outcome == DecisionOutcome::Deny {
        audit.record("completed", "report composer denied by policy");
        return Ok(ReportComposerResult {
            decision,
            summary: String::new(),
            citations: Vec::new(),
            audit: audit.into_trail(),
        });
    }

    let summary = build_summary(&output);
    let citations = output
        .items
        .iter()
        .map(|item| ReportCitation {
            source: REPORT_COMPOSER_RESOURCE.to_string(),
            label: item.label.clone(),
            value_minor_units: item.value_minor_units,
        })
        .collect();
    audit.record("artifact", "report summary composed");

    Ok(ReportComposerResult {
        decision,
        summary,
        citations,
        audit: audit.into_trail(),
    })
}

async fn fetch_report_preview(
    http: &reqwest::Client,
    api_server_url: &str,
    stdb_token: &str,
    input: &ReportComposerInput,
) -> Result<Value, String> {
    let url = format!(
        "{}/v1/reports/{}/preview",
        api_server_url.trim_end_matches('/'),
        urlencoding::encode(&input.report_key)
    );

    let body = serde_json::json!({
        "companyId": input.company_id,
        "date": input.date,
        "timezone": input.timezone,
    });

    let response = http
        .post(&url)
        .header("Authorization", format!("Bearer {stdb_token}"))
        .header("Content-Type", "application/json")
        .header("x-stdb-identity", "report-composer")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("api-server preview request failed: {error}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("failed to read api-server preview response: {error}"))?;

    if !status.is_success() {
        return Err(format!("api-server preview returned {status}: {text}"));
    }

    serde_json::from_str(&text).map_err(|error| format!("invalid api-server preview JSON: {error}"))
}

fn build_composer_output(
    report_key: &str,
    company_id: u64,
    preview: &Value,
) -> Result<ReportComposerOutput, String> {
    let report = preview
        .get("report")
        .ok_or("preview missing 'report' field")?;
    let currency = preview
        .get("currency")
        .ok_or("preview missing 'currency' field")?;
    let currency_id = currency
        .get("currencyId")
        .and_then(|v| v.as_u64())
        .ok_or("preview missing 'currency.currencyId'")?;
    let scale = currency
        .get("minorUnitScale")
        .and_then(|v| v.as_u64())
        .map(|v| v as u8)
        .unwrap_or(2);

    let totals = report
        .get("totals")
        .ok_or("preview missing 'report.totals'")?;

    let mut items = Vec::new();
    push_total(
        &mut items,
        "sales_gross",
        totals,
        "salesGross",
        company_id,
        currency_id,
        scale,
    )?;
    push_total(
        &mut items,
        "purchases_gross",
        totals,
        "purchasesGross",
        company_id,
        currency_id,
        scale,
    )?;
    push_total(
        &mut items,
        "receipts",
        totals,
        "receipts",
        company_id,
        currency_id,
        scale,
    )?;
    push_total(
        &mut items,
        "disbursements",
        totals,
        "disbursements",
        company_id,
        currency_id,
        scale,
    )?;
    push_total(
        &mut items,
        "fees_and_tax",
        totals,
        "feesAndTax",
        company_id,
        currency_id,
        scale,
    )?;
    push_total(
        &mut items,
        "net_cash_flow",
        totals,
        "netCashFlow",
        company_id,
        currency_id,
        scale,
    )?;

    Ok(ReportComposerOutput {
        report_key: report_key.to_string(),
        title: "Daily Business Summary".to_string(),
        items,
    })
}

fn push_total(
    items: &mut Vec<ReportSummaryItem>,
    label: &str,
    totals: &Value,
    field: &str,
    company_id: u64,
    currency_id: u64,
    scale: u8,
) -> Result<(), String> {
    let value = totals
        .get(field)
        .and_then(|v| v.get("minorUnits"))
        .and_then(|v| v.as_i64())
        .ok_or_else(|| format!("preview missing 'totals.{field}.minorUnits'"))?;

    items.push(ReportSummaryItem {
        company_id,
        label: label.to_string(),
        value_minor_units: value,
        currency_id,
        scale,
    });
    Ok(())
}

fn build_summary(output: &ReportComposerOutput) -> String {
    let mut parts = Vec::new();
    parts.push(format!("Daily business summary for {}.", output.report_key));
    for item in &output.items {
        let value = item.value_minor_units as f64 / 10f64.powi(item.scale as i32);
        parts.push(format!("{}: {:.2}", item.label, value));
    }
    parts.join(" ")
}
