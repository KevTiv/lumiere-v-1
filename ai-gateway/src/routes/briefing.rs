//! Read-only daily briefing generation from org activity context.
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    rig_agent::ContextHit,
    state::AppState,
};

const DEFAULT_BRIEFING_QUERY: &str =
    "recent ERP changes approvals import failures workflow activity notable risk";
const DEFAULT_TOP_K: usize = 8;
const MAX_TOP_K: usize = 25;

#[derive(Debug, Deserialize)]
pub struct BriefingGenerateRequest {
    pub org_id: u64,
    pub company_id: Option<u64>,
    pub since_micros: Option<i64>,
    pub until_micros: Option<i64>,
    #[serde(default)]
    pub allowed_modules: Vec<String>,
    pub activity_query: Option<String>,
    pub top_k: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct BriefingSection {
    pub title: String,
    pub summary: String,
    pub items: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BriefingSource {
    pub source_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub score: f32,
    pub text_snippet: String,
    pub timestamp: i64,
}

#[derive(Debug, Serialize)]
pub struct BriefingWindow {
    pub since_micros: Option<i64>,
    pub until_micros: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct BriefingModelMetadata {
    pub mode: String,
    pub searched_activity: bool,
    pub source_count: usize,
}

#[derive(Debug, Serialize)]
pub struct BriefingGenerateResponse {
    pub summary_md: String,
    pub sections: Vec<BriefingSection>,
    pub sources: Vec<BriefingSource>,
    pub window: BriefingWindow,
    pub model_metadata: BriefingModelMetadata,
}

fn module_allowed(entity_type: &str, allowed_modules: &[String]) -> bool {
    if allowed_modules.is_empty() {
        return true;
    }
    let entity = entity_type.to_ascii_lowercase();
    allowed_modules.iter().any(|module| {
        let module = module.trim().to_ascii_lowercase();
        !module.is_empty() && entity.contains(&module)
    })
}

fn filter_hits(req: &BriefingGenerateRequest, hits: Vec<ContextHit>) -> Vec<ContextHit> {
    hits.into_iter()
        .filter(|hit| {
            req.since_micros.is_none_or(|since| hit.timestamp >= since)
                && req.until_micros.is_none_or(|until| hit.timestamp <= until)
                && module_allowed(&hit.entity_type, &req.allowed_modules)
        })
        .collect()
}

fn build_sections(hits: &[ContextHit]) -> Vec<BriefingSection> {
    if hits.is_empty() {
        return Vec::new();
    }

    let mut by_entity = std::collections::BTreeMap::<String, Vec<&ContextHit>>::new();
    for hit in hits {
        by_entity
            .entry(hit.entity_type.clone())
            .or_default()
            .push(hit);
    }

    by_entity
        .into_iter()
        .map(|(entity_type, hits)| {
            let items = hits
                .iter()
                .take(5)
                .map(|hit| format!("{} #{}: {}", hit.entity_type, hit.entity_id, hit.text))
                .collect::<Vec<_>>();
            BriefingSection {
                title: entity_type.replace('_', " "),
                summary: format!("{} relevant activity item(s) found.", hits.len()),
                items,
            }
        })
        .collect()
}

fn build_summary_md(sections: &[BriefingSection]) -> String {
    if sections.is_empty() {
        return "No recent activity was found for the requested scope. Nothing needs attention from the available read-only context.".to_string();
    }

    let total_items = sections
        .iter()
        .map(|section| section.items.len())
        .sum::<usize>();
    let mut lines = vec![format!(
        "Found {total_items} grounded activity item(s) across {} area(s).",
        sections.len()
    )];
    for section in sections {
        lines.push(format!("- **{}**: {}", section.title, section.summary));
    }
    lines.join("\n")
}

fn hit_to_source(hit: ContextHit) -> BriefingSource {
    BriefingSource {
        source_type: hit.source,
        entity_type: hit.entity_type,
        entity_id: hit.entity_id,
        score: hit.score,
        text_snippet: hit.text,
        timestamp: hit.timestamp,
    }
}

pub async fn post_generate(
    State(state): State<AppState>,
    Json(req): Json<BriefingGenerateRequest>,
) -> AppResult<Json<BriefingGenerateResponse>> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    if req.company_id == Some(0) {
        return Err(AppError::BadRequest(
            "company_id must be non-zero when provided".into(),
        ));
    }
    if matches!((req.since_micros, req.until_micros), (Some(since), Some(until)) if since > until) {
        return Err(AppError::BadRequest(
            "since_micros must be less than or equal to until_micros".into(),
        ));
    }

    let query = req
        .activity_query
        .as_deref()
        .filter(|query| !query.trim().is_empty())
        .unwrap_or(DEFAULT_BRIEFING_QUERY);
    let top_k = req.top_k.unwrap_or(DEFAULT_TOP_K).clamp(1, MAX_TOP_K);

    let hits = match state.rig.search_org(req.org_id, query, top_k).await {
        Ok(hits) => filter_hits(&req, hits),
        Err(err) => {
            tracing::warn!(
                org_id = req.org_id,
                error = %err,
                "Briefing activity search failed; returning limited empty briefing"
            );
            Vec::new()
        }
    };

    let sections = build_sections(&hits);
    let summary_md = build_summary_md(&sections);
    let sources = hits.into_iter().map(hit_to_source).collect::<Vec<_>>();
    let source_count = sources.len();

    tracing::info!(
        org_id = req.org_id,
        company_id = req.company_id.unwrap_or(0),
        source_count,
        "Generated read-only briefing"
    );

    Ok(Json(BriefingGenerateResponse {
        summary_md,
        sections,
        sources,
        window: BriefingWindow {
            since_micros: req.since_micros,
            until_micros: req.until_micros,
        },
        model_metadata: BriefingModelMetadata {
            mode: "deterministic_read_only".to_string(),
            searched_activity: true,
            source_count,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_sections_produce_limited_summary() {
        let summary = build_summary_md(&[]);
        assert!(summary.contains("No recent activity"));
    }

    #[test]
    fn filter_hits_applies_window_and_modules() {
        let req = BriefingGenerateRequest {
            org_id: 1,
            company_id: None,
            since_micros: Some(100),
            until_micros: Some(200),
            allowed_modules: vec!["sale".to_string()],
            activity_query: None,
            top_k: None,
        };
        let hits = vec![
            ContextHit {
                score: 0.9,
                entity_type: "sale_order".to_string(),
                entity_id: "1".to_string(),
                text: "Changed".to_string(),
                timestamp: 150,
                source: "erp_activity".to_string(),
            },
            ContextHit {
                score: 0.8,
                entity_type: "project_task".to_string(),
                entity_id: "2".to_string(),
                text: "Changed".to_string(),
                timestamp: 150,
                source: "erp_activity".to_string(),
            },
        ];

        let filtered = filter_hits(&req, hits);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].entity_type, "sale_order");
    }
}
