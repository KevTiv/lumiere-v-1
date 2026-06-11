//! Deterministic report explanations. This route computes facts only and performs no writes.
use std::collections::HashMap;

use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const MAX_REPORT_LINES: usize = 500;
const MAX_HIGHLIGHTS: usize = 8;

#[derive(Debug, Clone, Deserialize)]
pub struct ReportLine {
    pub id: Option<String>,
    pub label: String,
    #[serde(default)]
    pub amount: f64,
    pub comparison_amount: Option<f64>,
    #[serde(default)]
    pub source_refs: Vec<ReportSourceRef>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReportSourceRef {
    pub model: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReportExplainRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub report_id: Option<String>,
    pub report_type: String,
    pub lines: Vec<ReportLine>,
    #[serde(default)]
    pub comparison_lines: Vec<ReportLine>,
    #[serde(default)]
    pub include_explanation: bool,
}

#[derive(Debug, Serialize)]
pub struct ReportLineFact {
    pub label: String,
    pub amount: f64,
    pub comparison_amount: Option<f64>,
    pub delta: Option<f64>,
    pub delta_percent: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ReportHighlight {
    pub label: String,
    pub message: String,
    pub severity: String,
    pub source_refs: Vec<ReportSourceRef>,
}

#[derive(Debug, Serialize)]
pub struct ReportExplainResponse {
    pub explanation_md: String,
    pub total: f64,
    pub comparison_total: Option<f64>,
    pub delta_total: Option<f64>,
    pub line_facts: Vec<ReportLineFact>,
    pub highlights: Vec<ReportHighlight>,
    pub source_refs: Vec<ReportSourceRef>,
    pub confidence_flags: Vec<String>,
}

fn line_key(line: &ReportLine) -> String {
    line.id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or(&line.label)
        .trim()
        .to_ascii_lowercase()
}

fn percent_delta(amount: f64, comparison: f64) -> Option<f64> {
    if comparison.abs() < f64::EPSILON {
        None
    } else {
        Some(((amount - comparison) / comparison.abs()) * 100.0)
    }
}

fn comparison_lookup(lines: &[ReportLine]) -> HashMap<String, f64> {
    lines
        .iter()
        .map(|line| (line_key(line), line.amount))
        .collect::<HashMap<_, _>>()
}

fn compute_line_facts(
    lines: &[ReportLine],
    comparison_lines: &[ReportLine],
) -> Vec<ReportLineFact> {
    let comparison = comparison_lookup(comparison_lines);
    lines
        .iter()
        .take(MAX_REPORT_LINES)
        .map(|line| {
            let comparison_amount = line
                .comparison_amount
                .or_else(|| comparison.get(&line_key(line)).copied());
            let delta = comparison_amount.map(|comparison| line.amount - comparison);
            let delta_percent =
                comparison_amount.and_then(|comparison| percent_delta(line.amount, comparison));
            ReportLineFact {
                label: line.label.clone(),
                amount: line.amount,
                comparison_amount,
                delta,
                delta_percent,
            }
        })
        .collect()
}

fn collect_sources(lines: &[ReportLine]) -> Vec<ReportSourceRef> {
    let mut sources = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for source in lines.iter().flat_map(|line| line.source_refs.iter()) {
        let key = format!("{}:{}", source.model, source.id);
        if seen.insert(key) {
            sources.push(source.clone());
        }
    }
    sources
}

fn build_highlights(lines: &[ReportLine], facts: &[ReportLineFact]) -> Vec<ReportHighlight> {
    let sources_by_label = lines
        .iter()
        .map(|line| (line.label.as_str(), line.source_refs.clone()))
        .collect::<HashMap<_, _>>();

    let mut ranked = facts
        .iter()
        .filter_map(|fact| fact.delta.map(|delta| (fact, delta)))
        .collect::<Vec<_>>();
    ranked.sort_by(|(_, a), (_, b)| {
        b.abs()
            .partial_cmp(&a.abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    ranked
        .into_iter()
        .take(MAX_HIGHLIGHTS)
        .map(|(fact, delta)| {
            let direction = if delta >= 0.0 {
                "increased"
            } else {
                "decreased"
            };
            let pct = fact
                .delta_percent
                .map(|pct| format!(" ({pct:.1}%)"))
                .unwrap_or_default();
            ReportHighlight {
                label: fact.label.clone(),
                message: format!(
                    "{} {} by {:.2}{} versus comparison.",
                    fact.label,
                    direction,
                    delta.abs(),
                    pct
                ),
                severity: if delta.abs() >= 10_000.0 {
                    "warning".to_string()
                } else {
                    "info".to_string()
                },
                source_refs: sources_by_label
                    .get(fact.label.as_str())
                    .cloned()
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn build_explanation(
    req: &ReportExplainRequest,
    total: f64,
    comparison_total: Option<f64>,
    delta_total: Option<f64>,
    highlights: &[ReportHighlight],
) -> String {
    if !req.include_explanation {
        return String::new();
    }

    let mut lines = vec![format!(
        "### {} report explanation",
        req.report_type.replace('_', " ")
    )];
    lines.push(format!("Current total: **{total:.2}**."));
    if let (Some(comparison), Some(delta)) = (comparison_total, delta_total) {
        let direction = if delta >= 0.0 { "up" } else { "down" };
        lines.push(format!(
            "Compared with the prior data, the report is {direction} **{:.2}** from **{comparison:.2}**.",
            delta.abs()
        ));
    } else {
        lines.push(
            "No complete comparison data was provided, so variance commentary is limited."
                .to_string(),
        );
    }

    if !highlights.is_empty() {
        lines.push("Top grounded drivers:".to_string());
        for highlight in highlights.iter().take(5) {
            lines.push(format!("- {}", highlight.message));
        }
    }

    lines.join("\n")
}

fn explain_report(req: &ReportExplainRequest) -> ReportExplainResponse {
    let line_facts = compute_line_facts(&req.lines, &req.comparison_lines);
    let total = line_facts.iter().map(|fact| fact.amount).sum::<f64>();
    let comparison_total = if req.comparison_lines.is_empty()
        && line_facts
            .iter()
            .all(|fact| fact.comparison_amount.is_none())
    {
        None
    } else {
        Some(
            line_facts
                .iter()
                .filter_map(|fact| fact.comparison_amount)
                .sum::<f64>(),
        )
    };
    let delta_total = comparison_total.map(|comparison| total - comparison);
    let highlights = build_highlights(&req.lines, &line_facts);
    let mut confidence_flags = Vec::new();
    if req.lines.len() > MAX_REPORT_LINES {
        confidence_flags.push(format!(
            "line facts limited to first {MAX_REPORT_LINES} rows"
        ));
    }
    if comparison_total.is_none() {
        confidence_flags.push("comparison data unavailable".to_string());
    }
    if collect_sources(&req.lines).is_empty() {
        confidence_flags.push("no source references supplied".to_string());
    }
    if req.lines.iter().any(|line| !line.metadata.is_null()) {
        confidence_flags.push("line metadata supplied but not interpreted".to_string());
    }

    let explanation_md = build_explanation(req, total, comparison_total, delta_total, &highlights);
    let source_refs = collect_sources(&req.lines);

    ReportExplainResponse {
        explanation_md,
        total,
        comparison_total,
        delta_total,
        line_facts,
        highlights,
        source_refs,
        confidence_flags,
    }
}

pub async fn post_explain(
    Json(req): Json<ReportExplainRequest>,
) -> AppResult<Json<ReportExplainResponse>> {
    if req.org_id == 0 || req.company_id == 0 {
        return Err(AppError::BadRequest(
            "org_id and company_id are required".into(),
        ));
    }
    if req.report_type.trim().is_empty() {
        return Err(AppError::BadRequest("report_type is required".into()));
    }
    if req.lines.is_empty() {
        return Err(AppError::BadRequest("lines must not be empty".into()));
    }

    let response = explain_report(&req);
    tracing::info!(
        org_id = req.org_id,
        company_id = req.company_id,
        report_id = req.report_id.as_deref().unwrap_or("adhoc"),
        report_type = %req.report_type,
        line_count = response.line_facts.len(),
        "Explained report deterministically"
    );

    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_line_and_total_deltas() {
        let req = ReportExplainRequest {
            org_id: 1,
            company_id: 2,
            report_id: None,
            report_type: "pnl".to_string(),
            lines: vec![ReportLine {
                id: Some("revenue".to_string()),
                label: "Revenue".to_string(),
                amount: 120.0,
                comparison_amount: Some(100.0),
                source_refs: Vec::new(),
                metadata: Value::Null,
            }],
            comparison_lines: Vec::new(),
            include_explanation: true,
        };

        let response = explain_report(&req);
        assert_eq!(response.total, 120.0);
        assert_eq!(response.delta_total, Some(20.0));
        assert_eq!(response.line_facts[0].delta_percent, Some(20.0));
        assert!(response.explanation_md.contains("Current total"));
    }
}
