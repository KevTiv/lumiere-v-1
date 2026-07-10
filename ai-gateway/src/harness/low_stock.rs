use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    data_scope_resolver::NamedResourceContract,
    manifest::{
        Capability, ExecutionLimits, PrivacyPolicy, ReviewMetadata, ReviewStatus, RiskClass,
        SkillManifest, SkillVersionRef,
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
