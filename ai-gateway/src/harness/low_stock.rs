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

pub const LOW_STOCK_SKILL_KEY: &str = "low_stock";
pub const LOW_STOCK_SKILL_VERSION: u32 = 1;
pub const LOW_STOCK_RESOURCE: &str = "inventory.low_stock.v1";
pub const LOW_STOCK_OUTPUT_TYPE: &str = "inventory.low_stock.result.v1";
pub const NAMED_READ_TOOL: &str = "named_resource_read";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LowStockInput {
    pub threshold: f64,
    #[serde(default)]
    pub location_id: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LowStockItem {
    pub organization_id: u64,
    pub company_id: u64,
    pub product_id: u64,
    pub sku: String,
    pub name: String,
    pub quantity_on_hand: f64,
    pub reorder_level: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LowStockOutput {
    pub items: Vec<LowStockItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LowStockScanResult {
    pub decision: PolicyResult,
    pub summary: String,
    pub items: Vec<LowStockItem>,
    pub audit: HarnessAuditTrail,
}

pub fn manifest() -> SkillManifest {
    SkillManifest {
        skill: SkillVersionRef::new(LOW_STOCK_SKILL_KEY, LOW_STOCK_SKILL_VERSION),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "phase1-policy".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        },
        risk: RiskClass::Green,
        named_resources: vec![LOW_STOCK_RESOURCE.to_string()],
        allowed_tools: vec![NAMED_READ_TOOL.to_string()],
        allowed_capabilities: vec![Capability::NamedRead],
        output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
        limits: ExecutionLimits {
            max_rows: 100,
            max_steps: 1,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new([
            "organization_id",
            "company_id",
            "product_id",
            "sku",
            "name",
            "quantity_on_hand",
            "reorder_level",
        ]),
    }
}

pub fn resource_contract() -> NamedResourceContract {
    NamedResourceContract {
        name: LOW_STOCK_RESOURCE.to_string(),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "phase1-policy".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        },
        output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
        rows_field: "items".to_string(),
        validate_input,
        validate_output,
    }
}

fn validate_input(value: &Value) -> Result<(), String> {
    let input: LowStockInput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid low-stock input: {error}"))?;
    if !input.threshold.is_finite() || input.threshold < 0.0 {
        return Err("low-stock threshold must be a finite non-negative number".to_string());
    }
    Ok(())
}

fn validate_output(value: &Value) -> Result<(), String> {
    let output: LowStockOutput = serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid low-stock output: {error}"))?;
    if output.items.iter().any(|item| {
        !item.quantity_on_hand.is_finite()
            || !item.reorder_level.is_finite()
            || item.quantity_on_hand < 0.0
            || item.reorder_level < 0.0
    }) {
        return Err("low-stock quantities must be finite non-negative numbers".to_string());
    }
    Ok(())
}

/// Scan scoped inventory for products at or below the requested threshold.
pub async fn scan_low_stock(
    stdb: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    input: LowStockInput,
    company_id: u64,
    policy: PolicyEngine,
) -> Result<LowStockScanResult, String> {
    let correlation_id = uuid::Uuid::new_v4().to_string();
    let mut audit = HarnessAuditLogger::new(correlation_id.clone());
    audit.record(
        "requested",
        format!(
            "low_stock org={organization_id} company={company_id} threshold={}",
            input.threshold
        ),
    );

    let output = fetch_low_stock_output(stdb, organization_id, company_id, &input).await?;
    audit.record(
        "resource_accessed",
        format!(
            "inventory.low_stock.v1 returned {} rows",
            output.items.len()
        ),
    );

    let request = PolicyControlledRequest {
        execution: PolicyExecutionRequest {
            skill: SkillVersionRef::new(LOW_STOCK_SKILL_KEY, LOW_STOCK_SKILL_VERSION),
            organization_id,
            company_id,
            correlation_id: correlation_id.clone(),
            metadata: ExecutionMetadata {
                actor_id: Some(identity_hex.to_string()),
                causation_id: Some(correlation_id),
                ..Default::default()
            },
            input: serde_json::to_value(&input).unwrap_or_default(),
            plan: ExecutionPlan {
                named_resources: vec![LOW_STOCK_RESOURCE.to_string()],
                tool_calls: vec![PlannedToolCall {
                    tool_name: NAMED_READ_TOOL.to_string(),
                    capability: Capability::NamedRead,
                    named_resource: Some(LOW_STOCK_RESOURCE.to_string()),
                }],
                steps: 1,
                expected_rows: output.items.len() as u32,
                output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
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
        audit.record("completed", "low_stock scan denied by policy");
        return Ok(LowStockScanResult {
            decision,
            summary: String::new(),
            items: Vec::new(),
            audit: audit.into_trail(),
        });
    }

    let summary = if output.items.is_empty() {
        "No low-stock products found for the selected threshold.".to_string()
    } else {
        format!(
            "Found {} product(s) at or below threshold {}.",
            output.items.len(),
            input.threshold
        )
    };
    audit.record("artifact", "low-stock summary composed");

    Ok(LowStockScanResult {
        decision,
        summary,
        items: output.items,
        audit: audit.into_trail(),
    })
}

async fn fetch_low_stock_output(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    input: &LowStockInput,
) -> Result<LowStockOutput, String> {
    validate_input(&serde_json::to_value(input).unwrap_or_default())?;

    let product_sql = format!(
        "SELECT id, default_code, name, reordering_min_qty FROM product WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT 500"
    );
    let quant_sql = format!(
        "SELECT product_id, location_id, quantity FROM stock_quant WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT 500"
    );

    let products = stdb
        .query_sql(&product_sql)
        .await
        .map_err(|error| format!("load products: {error}"))?;
    let quants = stdb
        .query_sql(&quant_sql)
        .await
        .map_err(|error| format!("load stock quants: {error}"))?;

    evaluate_low_stock_rows(
        &products,
        &quants,
        organization_id,
        company_id,
        input,
        manifest().limits.max_rows as usize,
    )
}

pub(crate) fn evaluate_low_stock_rows(
    products: &[Value],
    quants: &[Value],
    organization_id: u64,
    company_id: u64,
    input: &LowStockInput,
    max_rows: usize,
) -> Result<LowStockOutput, String> {
    let mut quantity_by_product = std::collections::BTreeMap::<u64, f64>::new();
    for row in quants {
        if input.location_id.is_some()
            && row_u64(row, "locationId", "location_id") != input.location_id
        {
            continue;
        }
        let product_id = row_u64(&row, "productId", "product_id").unwrap_or(0);
        if product_id == 0 {
            continue;
        }
        let quantity = row_f64(&row, "quantity").unwrap_or(0.0);
        *quantity_by_product.entry(product_id).or_default() += quantity;
    }

    let mut items = Vec::new();
    for row in products {
        let product_id = row_u64(&row, "id", "id").unwrap_or(0);
        if product_id == 0 {
            continue;
        }
        let quantity_on_hand = quantity_by_product.get(&product_id).copied().unwrap_or(0.0);
        let reorder_level = row_f64(&row, "reorderingMinQty")
            .or_else(|| row_f64(&row, "reordering_min_qty"))
            .unwrap_or(0.0);
        let threshold = if reorder_level > 0.0 {
            reorder_level
        } else {
            input.threshold
        };
        if quantity_on_hand > threshold {
            continue;
        }
        items.push(LowStockItem {
            organization_id,
            company_id,
            product_id,
            sku: row_string(&row, "defaultCode", Some("default_code")).unwrap_or_default(),
            name: row_string(&row, "name", None)
                .unwrap_or_else(|| format!("Product #{product_id}")),
            quantity_on_hand,
            reorder_level: threshold,
        });
        if items.len() > max_rows {
            return Err("low-stock row limit exceeded".to_string());
        }
    }

    items.sort_by(|left, right| {
        left.quantity_on_hand
            .partial_cmp(&right.quantity_on_hand)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let output = LowStockOutput { items };
    validate_output(&serde_json::to_value(&output).unwrap_or_default())?;
    Ok(output)
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_f64(row: &Value, field: &str) -> Option<f64> {
    let camel = snake_to_camel(field);
    row.get(&camel)
        .or_else(|| row.get(field))
        .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_string(row: &Value, camel: &str, snake: Option<&str>) -> Option<String> {
    row.get(camel)
        .or_else(|| snake.and_then(|field| row.get(field)))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn snake_to_camel(value: &str) -> String {
    let mut out = String::new();
    let mut uppercase = false;
    for character in value.chars() {
        if character == '_' {
            uppercase = true;
        } else if uppercase {
            out.extend(character.to_uppercase());
            uppercase = false;
        } else {
            out.push(character);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_stock_contract_accepts_typed_values() {
        validate_input(&serde_json::json!({"threshold": 5.0, "location_id": 9})).unwrap();
        validate_output(&serde_json::json!({
            "items": [{
                "organization_id": 1,
                "company_id": 2,
                "product_id": 3,
                "sku": "W-1",
                "name": "Widget",
                "quantity_on_hand": 2.0,
                "reorder_level": 5.0
            }]
        }))
        .unwrap();
    }

    #[test]
    fn low_stock_contract_rejects_unknown_input_fields() {
        let error =
            validate_input(&serde_json::json!({"threshold": 5.0, "sql": "SELECT *"})).unwrap_err();
        assert!(error.contains("unknown field"));
    }
}
