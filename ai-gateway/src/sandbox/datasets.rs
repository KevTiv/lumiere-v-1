use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum DatasetSpec {
    #[serde(rename = "stdb_table")]
    StdbTable {
        key: String,
        table: String,
        #[serde(default = "default_org_column")]
        org_column: String,
        #[serde(default = "default_company_column")]
        company_column: String,
        #[serde(default = "default_row_limit")]
        limit: u32,
        #[serde(default)]
        extra_where: Option<String>,
    },
    Input {
        key: String,
        input_field: String,
    },
}

fn default_org_column() -> String {
    "organization_id".to_string()
}

fn default_company_column() -> String {
    "company_id".to_string()
}

fn default_row_limit() -> u32 {
    2_000
}

pub fn parse_dataset_specs(raw: Option<&str>) -> Vec<DatasetSpec> {
    let Some(text) = raw.filter(|s| !s.trim().is_empty()) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    let Some(arr) = value.get("datasets").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| serde_json::from_value(item.clone()).ok())
        .collect()
}

pub fn default_report_analysis_specs() -> Vec<DatasetSpec> {
    vec![
        DatasetSpec::StdbTable {
            key: "sale_order_lines".to_string(),
            table: "sale_order_line".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 2_000,
            extra_where: None,
        },
        DatasetSpec::StdbTable {
            key: "stock_moves".to_string(),
            table: "stock_move".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 2_000,
            extra_where: None,
        },
        DatasetSpec::StdbTable {
            key: "financial_reports".to_string(),
            table: "financial_report".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 500,
            extra_where: None,
        },
        DatasetSpec::Input {
            key: "report_lines".to_string(),
            input_field: "report_lines".to_string(),
        },
    ]
}

pub fn default_price_search_specs() -> Vec<DatasetSpec> {
    vec![
        DatasetSpec::StdbTable {
            key: "products".to_string(),
            table: "product".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 1_000,
            extra_where: None,
        },
        DatasetSpec::StdbTable {
            key: "purchase_orders".to_string(),
            table: "purchase_order".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 1_000,
            extra_where: None,
        },
        DatasetSpec::StdbTable {
            key: "partners".to_string(),
            table: "contact".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 500,
            extra_where: None,
        },
    ]
}

pub fn default_process_research_specs() -> Vec<DatasetSpec> {
    vec![
        DatasetSpec::StdbTable {
            key: "stock_moves".to_string(),
            table: "stock_move".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 2_000,
            extra_where: None,
        },
        DatasetSpec::StdbTable {
            key: "purchase_orders".to_string(),
            table: "purchase_order".to_string(),
            org_column: "organization_id".to_string(),
            company_column: "company_id".to_string(),
            limit: 1_000,
            extra_where: None,
        },
        DatasetSpec::StdbTable {
            key: "workflow_instances".to_string(),
            table: "workflow_instance".to_string(),
            org_column: "organization_id".to_string(),
            company_column: String::new(),
            limit: 1_000,
            extra_where: None,
        },
    ]
}

pub fn dataset_table_name(key: &str) -> Result<String> {
    let sanitized: String = key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    if sanitized.is_empty() {
        return Err(anyhow!("invalid dataset key"));
    }
    if sanitized.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return Ok(format!("ds_{sanitized}"));
    }
    Ok(sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_specs_from_json() {
        let raw = r#"{"datasets":[{"source":"stdb_table","key":"products","table":"product"}]}"#;
        let specs = parse_dataset_specs(Some(raw));
        assert_eq!(specs.len(), 1);
    }
}
