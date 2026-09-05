//! Reviewed green controls for distributor credit exposure and delivery runs.
//!
//! Both adapters are deliberately read-only: they surface records that need a
//! human review and never release a credit hold, confirm a picking, or post a
//! payment.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use stdb_client::StdbClient;

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

pub const CREDIT_HOLD_SKILL_KEY: &str = "credit_hold_summary";
pub const DELIVERY_RUN_SKILL_KEY: &str = "delivery_run_summary";
pub const DISTRIBUTOR_CONTROL_SKILL_VERSION: u32 = 1;
pub const CREDIT_HOLD_RESOURCE: &str = "distributor.credit_exposure.v1";
pub const DELIVERY_RUN_RESOURCE: &str = "distributor.delivery_run.v1";
pub const NAMED_READ_TOOL: &str = "named_resource_read";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreditHoldInput {
    #[serde(default = "default_minimum_outstanding")]
    pub minimum_outstanding: f64,
}

fn default_minimum_outstanding() -> f64 {
    0.01
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreditHoldItem {
    pub organization_id: u64,
    pub company_id: u64,
    pub partner_id: u64,
    pub customer_name: String,
    pub outstanding_amount: f64,
    pub open_invoice_count: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreditHoldOutput {
    pub items: Vec<CreditHoldItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditHoldSummaryResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub items: Vec<CreditHoldItem>,
    pub audit: HarnessAuditTrail,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryRunInput {
    #[serde(default)]
    pub include_done: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryRunItem {
    pub organization_id: u64,
    pub company_id: u64,
    pub picking_id: u64,
    pub name: String,
    pub state: String,
    pub sale_order_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub scheduled_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryRunOutput {
    pub items: Vec<DeliveryRunItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryRunSummaryResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub items: Vec<DeliveryRunItem>,
    pub audit: HarnessAuditTrail,
}

pub fn credit_hold_manifest() -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(CREDIT_HOLD_SKILL_KEY, DISTRIBUTOR_CONTROL_SKILL_VERSION),
        review: reviewed_metadata(),
        risk: RiskClass::Green,
        named_resources: vec![CREDIT_HOLD_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: "distributor.credit_exposure.result.v1".to_string(),
        limits: read_limits(),
        privacy: PrivacyPolicy::new([
            "organization_id",
            "company_id",
            "partner_id",
            "customer_name",
            "outstanding_amount",
            "open_invoice_count",
        ]),
    }
}

pub fn delivery_run_manifest() -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(DELIVERY_RUN_SKILL_KEY, DISTRIBUTOR_CONTROL_SKILL_VERSION),
        review: reviewed_metadata(),
        risk: RiskClass::Green,
        named_resources: vec![DELIVERY_RUN_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: "distributor.delivery_run.result.v1".to_string(),
        limits: read_limits(),
        privacy: PrivacyPolicy::new([
            "organization_id",
            "company_id",
            "picking_id",
            "name",
            "state",
            "sale_order_id",
            "partner_id",
            "scheduled_at",
        ]),
    }
}

pub fn credit_hold_resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: CREDIT_HOLD_RESOURCE.to_string(),
        review: reviewed_metadata(),
        output_type: credit_hold_manifest().output_type,
        rows_field: "items".to_string(),
        validate_input: validate_credit_hold_input,
        validate_output: validate_credit_hold_output,
    }
}

pub fn delivery_run_resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: DELIVERY_RUN_RESOURCE.to_string(),
        review: reviewed_metadata(),
        output_type: delivery_run_manifest().output_type,
        rows_field: "items".to_string(),
        validate_input: validate_delivery_run_input,
        validate_output: validate_delivery_run_output,
    }
}

pub async fn summarize_credit_exposure(
    stdb: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    input: CreditHoldInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<CreditHoldSummaryResult, String> {
    validate_credit_hold_input(&serde_json::to_value(&input).unwrap_or_default())?;
    let output = fetch_credit_hold_output(stdb, organization_id, company_id, &input).await?;
    let mut audit = HarnessAuditLogger::new(uuid::Uuid::new_v4().to_string());
    audit.record(
        "requested",
        format!("credit_hold_summary org={organization_id} company={company_id}"),
    );
    audit.record(
        "resource_accessed",
        format!(
            "{CREDIT_HOLD_RESOURCE} returned {} rows",
            output.items.len()
        ),
    );
    let decision = execute_read_policy(
        &policy,
        CREDIT_HOLD_SKILL_KEY,
        CREDIT_HOLD_RESOURCE,
        credit_hold_manifest().output_type.as_str(),
        organization_id,
        company_id,
        identity_hex,
        &input,
        &output,
        audit.correlation_id(),
    );
    audit.record("policy", format!("outcome={:?}", decision.decision.outcome));
    let items = if decision.decision.outcome == DecisionOutcome::Deny {
        Vec::new()
    } else {
        output.items
    };
    let summary = if items.is_empty() {
        "No customer credit exposure requires review at the selected threshold.".to_string()
    } else {
        format!(
            "{} customer account(s) have open receivables requiring credit review.",
            items.len()
        )
    };
    audit.record("completed", "credit exposure summary composed");
    Ok(CreditHoldSummaryResult {
        decision,
        summary,
        items,
        audit: audit.into_trail(),
    })
}

pub async fn summarize_delivery_run(
    stdb: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    input: DeliveryRunInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<DeliveryRunSummaryResult, String> {
    validate_delivery_run_input(&serde_json::to_value(&input).unwrap_or_default())?;
    let output = fetch_delivery_run_output(stdb, organization_id, company_id, &input).await?;
    let mut audit = HarnessAuditLogger::new(uuid::Uuid::new_v4().to_string());
    audit.record(
        "requested",
        format!("delivery_run_summary org={organization_id} company={company_id}"),
    );
    audit.record(
        "resource_accessed",
        format!(
            "{DELIVERY_RUN_RESOURCE} returned {} rows",
            output.items.len()
        ),
    );
    let decision = execute_read_policy(
        &policy,
        DELIVERY_RUN_SKILL_KEY,
        DELIVERY_RUN_RESOURCE,
        delivery_run_manifest().output_type.as_str(),
        organization_id,
        company_id,
        identity_hex,
        &input,
        &output,
        audit.correlation_id(),
    );
    audit.record("policy", format!("outcome={:?}", decision.decision.outcome));
    let items = if decision.decision.outcome == DecisionOutcome::Deny {
        Vec::new()
    } else {
        output.items
    };
    let summary = if items.is_empty() {
        "No deliveries are currently waiting for review.".to_string()
    } else {
        format!(
            "{} delivery picking(s) are in the reviewed run.",
            items.len()
        )
    };
    audit.record("completed", "delivery run summary composed");
    Ok(DeliveryRunSummaryResult {
        decision,
        summary,
        items,
        audit: audit.into_trail(),
    })
}

fn execute_read_policy<I: Serialize, O: Serialize>(
    policy: &PolicyEngine,
    skill_key: &str,
    resource: &str,
    output_type: &str,
    organization_id: u64,
    company_id: u64,
    identity_hex: &str,
    input: &I,
    output: &O,
    correlation_id: &str,
) -> PolicyResult {
    policy.execute_controlled(PolicyControlledRequest {
        execution: PolicyExecutionRequest {
            skill: SkillVersionRef::new(skill_key, DISTRIBUTOR_CONTROL_SKILL_VERSION),
            organization_id,
            company_id,
            correlation_id: correlation_id.to_string(),
            metadata: ExecutionMetadata {
                actor_id: Some(identity_hex.to_string()),
                causation_id: Some(correlation_id.to_string()),
                ..Default::default()
            },
            input: serde_json::to_value(input).unwrap_or_default(),
            plan: ExecutionPlan {
                named_resources: vec![resource.to_string()],
                tool_calls: vec![PlannedToolCall {
                    tool_name: NAMED_READ_TOOL.to_string(),
                    capability: Capability::NamedRead,
                    named_resource: Some(resource.to_string()),
                }],
                steps: 1,
                expected_rows: row_count(output),
                output_type: output_type.to_string(),
            },
        },
        candidate_output: serde_json::to_value(output).unwrap_or_default(),
    })
}

fn row_count<O: Serialize>(output: &O) -> u32 {
    serde_json::to_value(output)
        .ok()
        .and_then(|value| {
            value
                .get("items")
                .and_then(Value::as_array)
                .map(|items| items.len() as u32)
        })
        .unwrap_or(0)
}

async fn fetch_credit_hold_output(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    input: &CreditHoldInput,
) -> Result<CreditHoldOutput, String> {
    let sql = format!(
        "SELECT partner_id, invoice_partner_display_name, amount_residual FROM account_move WHERE organization_id = {organization_id} AND company_id = {company_id} AND state = 'Posted' AND move_type = 'OutInvoice' AND amount_residual >= {} LIMIT 500",
        input.minimum_outstanding,
    );
    let rows = stdb
        .query_sql(&sql)
        .await
        .map_err(|error| format!("load customer exposure: {error}"))?;
    let mut items = std::collections::BTreeMap::<u64, CreditHoldItem>::new();
    for row in rows {
        let Some(partner_id) = row_u64(&row, "partnerId", "partner_id") else {
            continue;
        };
        let amount = row_f64(&row, "amount_residual").unwrap_or(0.0);
        if amount < input.minimum_outstanding {
            continue;
        }
        let entry = items.entry(partner_id).or_insert_with(|| CreditHoldItem {
            organization_id,
            company_id,
            partner_id,
            customer_name: row_string(
                &row,
                "invoicePartnerDisplayName",
                "invoice_partner_display_name",
            )
            .unwrap_or_else(|| format!("Customer #{partner_id}")),
            outstanding_amount: 0.0,
            open_invoice_count: 0,
        });
        entry.outstanding_amount += amount;
        entry.open_invoice_count += 1;
    }
    let mut items = items.into_values().collect::<Vec<_>>();
    items.sort_by(|left, right| {
        right
            .outstanding_amount
            .partial_cmp(&left.outstanding_amount)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let output = CreditHoldOutput { items };
    validate_credit_hold_output(&serde_json::to_value(&output).unwrap_or_default())?;
    Ok(output)
}

async fn fetch_delivery_run_output(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    input: &DeliveryRunInput,
) -> Result<DeliveryRunOutput, String> {
    let state_clause = if input.include_done {
        "state != 'cancel'"
    } else {
        "state != 'done' AND state != 'cancel'"
    };
    let sql = format!(
        "SELECT id, name, state, sale_id, partner_id, scheduled_date FROM stock_picking WHERE organization_id = {organization_id} AND company_id = {company_id} AND is_return = false AND {state_clause} LIMIT 500"
    );
    let rows = stdb
        .query_sql(&sql)
        .await
        .map_err(|error| format!("load delivery run: {error}"))?;
    let items = rows
        .into_iter()
        .filter_map(|row| {
            let picking_id = row_u64(&row, "id", "id")?;
            Some(DeliveryRunItem {
                organization_id,
                company_id,
                picking_id,
                name: row_string(&row, "name", "name")
                    .unwrap_or_else(|| format!("Picking #{picking_id}")),
                state: row_string(&row, "state", "state").unwrap_or_default(),
                sale_order_id: row_u64(&row, "saleId", "sale_id"),
                partner_id: row_u64(&row, "partnerId", "partner_id"),
                scheduled_at: row
                    .get("scheduledDate")
                    .or_else(|| row.get("scheduled_date"))
                    .map(Value::to_string),
            })
        })
        .collect::<Vec<_>>();
    let output = DeliveryRunOutput { items };
    validate_delivery_run_output(&serde_json::to_value(&output).unwrap_or_default())?;
    Ok(output)
}

fn validate_credit_hold_input(value: &Value) -> Result<(), String> {
    let input: CreditHoldInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid credit-hold input: {error}"))?;
    if !input.minimum_outstanding.is_finite() || input.minimum_outstanding < 0.0 {
        return Err("minimum_outstanding must be a finite non-negative number".to_string());
    }
    Ok(())
}

fn validate_credit_hold_output(value: &Value) -> Result<(), String> {
    let output: CreditHoldOutput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid credit-hold output: {error}"))?;
    if output
        .items
        .iter()
        .any(|item| !item.outstanding_amount.is_finite() || item.outstanding_amount < 0.0)
    {
        return Err("credit exposure values must be finite non-negative numbers".to_string());
    }
    Ok(())
}

fn validate_delivery_run_input(value: &Value) -> Result<(), String> {
    serde_json::from_value::<DeliveryRunInput>(value.clone())
        .map_err(|error| format!("invalid delivery-run input: {error}"))?;
    Ok(())
}

fn validate_delivery_run_output(value: &Value) -> Result<(), String> {
    let output: DeliveryRunOutput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid delivery-run output: {error}"))?;
    if output
        .items
        .iter()
        .any(|item| item.picking_id == 0 || item.state.is_empty())
    {
        return Err("delivery run items require picking_id and state".to_string());
    }
    Ok(())
}

fn reviewed_metadata() -> ReviewMetadata {
    ReviewMetadata {
        status: ReviewStatus::Promoted,
        reviewed_by: "phase5-distributor".to_string(),
        reviewed_at: "2026-07-13T00:00:00Z".to_string(),
    }
}

fn read_limits() -> ExecutionLimits {
    ExecutionLimits {
        max_rows: 100,
        max_steps: 1,
        max_tool_calls: 1,
    }
}

use crate::wire_decode::{row_u64, snake_to_camel};
fn row_f64(row: &Value, field: &str) -> Option<f64> {
    row.get(&snake_to_camel(field))
        .or_else(|| row.get(field))
        .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
}
fn row_string(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_contracts_reject_unknown_input_fields() {
        assert!(validate_credit_hold_input(&serde_json::json!({"sql":"SELECT *"})).is_err());
        assert!(validate_delivery_run_input(&serde_json::json!({"mutate":true})).is_err());
    }

    #[test]
    fn control_contracts_accept_scoped_rows() {
        validate_credit_hold_output(&serde_json::json!({"items":[{"organization_id":1,"company_id":2,"partner_id":3,"customer_name":"Acme","outstanding_amount":12.5,"open_invoice_count":1}]})).unwrap();
        validate_delivery_run_output(&serde_json::json!({"items":[{"organization_id":1,"company_id":2,"picking_id":3,"name":"OUT/1","state":"assigned","sale_order_id":1,"partner_id":2,"scheduled_at":null}]})).unwrap();
    }
}
