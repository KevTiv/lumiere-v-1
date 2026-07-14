//! Read-only insight detectors used by the insights_scan skill.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::AppState;

const DETECTOR_TABLES: &[&str] = &[
    "sale_order",
    "project_task",
    "account_move",
    "mrp_production",
    "iot_telemetry",
];
const MAX_PREVIEW_INSIGHTS: usize = 20;

pub type InsightsScanResult = InsightsGenerateResponse;

#[derive(Debug, Clone, Deserialize)]
pub struct InsightsScanRequest {
    pub org_id: u64,
    pub company_id: Option<u64>,
    pub max_insights: Option<usize>,
    pub abnormal_amount_threshold: Option<f64>,
}

pub async fn scan_insights(state: &AppState, req: InsightsScanRequest) -> InsightsGenerateResponse {
    let inner = InsightsGenerateRequest {
        org_id: req.org_id,
        company_id: req.company_id,
        max_insights: req.max_insights,
        abnormal_amount_threshold: req.abnormal_amount_threshold,
    };
    generate_insights(state, inner).await
}

#[derive(Debug, Deserialize)]
struct InsightsGenerateRequest {
    pub org_id: u64,
    pub company_id: Option<u64>,
    pub max_insights: Option<usize>,
    pub abnormal_amount_threshold: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PreviewInsight {
    pub detector_id: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub related_model: String,
    pub related_id: Option<u64>,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DetectorCount {
    pub detector_id: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct InsightsGenerateResponse {
    pub created_count: usize,
    pub skipped_count: usize,
    pub candidate_count: usize,
    pub counts: Vec<DetectorCount>,
    pub preview_insights: Vec<PreviewInsight>,
    pub persisted: bool,
    pub warnings: Vec<String>,
}

fn row_field<'a>(row: &'a Value, snake_key: &str) -> Option<&'a Value> {
    let camel = snake_to_camel_key(snake_key);
    row.get(snake_key).or_else(|| row.get(&camel))
}

fn snake_to_camel_key(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut upper = false;
    for c in s.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn value_to_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|v| (v >= 0).then_some(v as u64)))
        .or_else(|| value.as_str().and_then(|s| s.parse::<u64>().ok()))
}

fn value_to_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|v| v as f64))
        .or_else(|| value.as_u64().map(|v| v as f64))
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
}

fn value_to_bool(value: &Value) -> Option<bool> {
    value
        .as_bool()
        .or_else(|| match value.as_str()?.to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" => Some(true),
            "false" | "no" | "0" => Some(false),
            _ => None,
        })
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|v| v.to_string()))
        .or_else(|| value.as_i64().map(|v| v.to_string()))
}

fn row_matches_scope(row: &Value, org_id: u64, company_id: Option<u64>) -> bool {
    let row_org = row_field(row, "organization_id").and_then(value_to_u64);
    if row_org != Some(org_id) {
        return false;
    }
    if let Some(company_id) = company_id {
        let row_company = row_field(row, "company_id").and_then(value_to_u64);
        if row_company != Some(company_id) {
            return false;
        }
    }
    true
}

fn related_id(row: &Value) -> Option<u64> {
    row_field(row, "id").and_then(value_to_u64)
}

fn detect_sale_order(row: &Value) -> Option<PreviewInsight> {
    let state = row_field(row, "state").and_then(value_to_string)?;
    if !matches!(state.as_str(), "draft" | "sent") {
        return None;
    }
    let id = related_id(row);
    let amount = row_field(row, "amount_total")
        .and_then(value_to_f64)
        .unwrap_or(0.0);
    Some(PreviewInsight {
        detector_id: "sales_order_pending".to_string(),
        severity: if amount > 10_000.0 { "warning" } else { "info" }.to_string(),
        title: "Sales order pending confirmation".to_string(),
        description: format!(
            "Sale order {:?} is still in {state} state with amount {amount:.2}.",
            id
        ),
        related_model: "sale_order".to_string(),
        related_id: id,
        confidence: 0.82,
        evidence: vec![
            format!("state={state}"),
            format!("amount_total={amount:.2}"),
        ],
    })
}

fn detect_project_task(row: &Value) -> Option<PreviewInsight> {
    let blocked = row_field(row, "is_blocked")
        .and_then(value_to_bool)
        .unwrap_or(false);
    if !blocked {
        return None;
    }
    let id = related_id(row);
    let name = row_field(row, "name")
        .and_then(value_to_string)
        .unwrap_or_else(|| "Untitled task".to_string());
    Some(PreviewInsight {
        detector_id: "project_task_blocked".to_string(),
        severity: "warning".to_string(),
        title: "Blocked project task".to_string(),
        description: format!("Task '{name}' is marked blocked."),
        related_model: "project_task".to_string(),
        related_id: id,
        confidence: 0.88,
        evidence: vec!["is_blocked=true".to_string()],
    })
}

fn detect_account_move(row: &Value, threshold: f64) -> Option<PreviewInsight> {
    let amount = row_field(row, "amount_total").and_then(value_to_f64)?;
    if amount.abs() < threshold {
        return None;
    }
    let id = related_id(row);
    Some(PreviewInsight {
        detector_id: "account_move_abnormal_amount".to_string(),
        severity: "warning".to_string(),
        title: "Large accounting move".to_string(),
        description: format!(
            "Journal entry {:?} has amount {amount:.2}, above threshold {threshold:.2}.",
            id
        ),
        related_model: "account_move".to_string(),
        related_id: id,
        confidence: 0.78,
        evidence: vec![format!("amount_total={amount:.2}")],
    })
}

fn detect_mrp_production(row: &Value) -> Option<PreviewInsight> {
    let state = row_field(row, "state").and_then(value_to_string)?;
    if !matches!(state.as_str(), "confirmed" | "planned" | "progress") {
        return None;
    }
    let id = related_id(row);
    Some(PreviewInsight {
        detector_id: "manufacturing_order_open".to_string(),
        severity: "info".to_string(),
        title: "Open manufacturing order".to_string(),
        description: format!("Manufacturing order {:?} is active in {state} state.", id),
        related_model: "mrp_production".to_string(),
        related_id: id,
        confidence: 0.7,
        evidence: vec![format!("state={state}")],
    })
}

fn detect_iot_telemetry(row: &Value) -> Option<PreviewInsight> {
    let value = row_field(row, "value").and_then(value_to_f64)?;
    if value.abs() <= 100.0 {
        return None;
    }
    let id = related_id(row);
    Some(PreviewInsight {
        detector_id: "iot_reading_outside_default_threshold".to_string(),
        severity: "warning".to_string(),
        title: "IoT reading outside default threshold".to_string(),
        description: format!("Telemetry {:?} reported value {value:.2}.", id),
        related_model: "iot_telemetry".to_string(),
        related_id: id,
        confidence: 0.66,
        evidence: vec![format!("value={value:.2}")],
    })
}

fn detect_rows(table: &str, rows: &[Value], req: &InsightsGenerateRequest) -> Vec<PreviewInsight> {
    let threshold = req.abnormal_amount_threshold.unwrap_or(10_000.0).abs();
    rows.iter()
        .filter(|row| row_matches_scope(row, req.org_id, req.company_id))
        .filter_map(|row| match table {
            "sale_order" => detect_sale_order(row),
            "project_task" => detect_project_task(row),
            "account_move" => detect_account_move(row, threshold),
            "mrp_production" => detect_mrp_production(row),
            "iot_telemetry" => detect_iot_telemetry(row),
            _ => None,
        })
        .collect()
}

fn counts_from_insights(insights: &[PreviewInsight]) -> Vec<DetectorCount> {
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    for insight in insights {
        *counts.entry(insight.detector_id.clone()).or_default() += 1;
    }
    counts
        .into_iter()
        .map(|(detector_id, count)| DetectorCount { detector_id, count })
        .collect()
}

async fn generate_insights(
    state: &AppState,
    req: InsightsGenerateRequest,
) -> InsightsGenerateResponse {
    let mut warnings = vec![
        "read-only MVP: generated insights are returned as previews and are not persisted"
            .to_string(),
    ];
    let mut candidates = Vec::new();

    for table in DETECTOR_TABLES {
        match state.stdb.query_table(table).await {
            Ok(rows) => candidates.extend(detect_rows(table, &rows, &req)),
            Err(err) => {
                tracing::warn!(table, error = %err, "Insight detector table read failed");
                warnings.push(format!("skipped {table}: {err}"));
            }
        }
    }

    let candidate_count = candidates.len();
    let max_insights = req
        .max_insights
        .unwrap_or(MAX_PREVIEW_INSIGHTS)
        .clamp(1, MAX_PREVIEW_INSIGHTS);
    candidates.truncate(max_insights);
    let counts = counts_from_insights(&candidates);

    tracing::info!(
        org_id = req.org_id,
        company_id = req.company_id.unwrap_or(0),
        candidate_count,
        preview_count = candidates.len(),
        "Generated read-only insight previews"
    );

    InsightsGenerateResponse {
        created_count: 0,
        skipped_count: candidate_count,
        candidate_count,
        counts,
        preview_insights: candidates,
        persisted: false,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_pending_sale_order_in_scope() {
        let req = InsightsGenerateRequest {
            org_id: 1,
            company_id: Some(2),
            max_insights: None,
            abnormal_amount_threshold: None,
        };
        let rows = vec![json!({
            "organization_id": 1,
            "company_id": 2,
            "id": 10,
            "state": "draft",
            "amount_total": 50.0
        })];

        let insights = detect_rows("sale_order", &rows, &req);
        assert_eq!(insights.len(), 1);
        assert_eq!(insights[0].detector_id, "sales_order_pending");
    }

    #[test]
    fn scope_filter_rejects_other_company() {
        let row = json!({ "organization_id": 1, "company_id": 3 });
        assert!(!row_matches_scope(&row, 1, Some(2)));
    }
}
