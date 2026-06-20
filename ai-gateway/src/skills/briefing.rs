//! Activity context collection for the daily_briefing skill.

use serde::{Deserialize, Serialize};

use crate::rig_agent::ContextHit;

const DEFAULT_BRIEFING_QUERY: &str =
    "recent ERP changes approvals import failures workflow activity notable risk";
const DEFAULT_TOP_K: usize = 8;
const MAX_TOP_K: usize = 25;

#[derive(Debug, Clone, Deserialize)]
pub struct BriefingContextRequest {
    pub org_id: u64,
    pub company_id: Option<u64>,
    pub since_micros: Option<i64>,
    pub until_micros: Option<i64>,
    #[serde(default)]
    pub allowed_modules: Vec<String>,
    pub activity_query: Option<String>,
    pub top_k: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BriefingSection {
    pub title: String,
    pub summary: String,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BriefingSource {
    pub source_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub score: f32,
    pub text_snippet: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BriefingContext {
    pub summary_md: String,
    pub sections: Vec<BriefingSection>,
    pub sources: Vec<BriefingSource>,
    pub activity_query: String,
    pub source_count: usize,
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

fn filter_hits(req: &BriefingContextRequest, hits: Vec<ContextHit>) -> Vec<ContextHit> {
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

pub async fn collect_briefing_context(
    rig: &crate::rig_agent::RigContext,
    req: BriefingContextRequest,
) -> BriefingContext {
    let query = req
        .activity_query
        .as_deref()
        .filter(|query| !query.trim().is_empty())
        .unwrap_or(DEFAULT_BRIEFING_QUERY)
        .to_string();
    let top_k = req.top_k.unwrap_or(DEFAULT_TOP_K).clamp(1, MAX_TOP_K);

    let hits = match rig.search_org(req.org_id, &query, top_k).await {
        Ok(hits) => filter_hits(&req, hits),
        Err(err) => {
            tracing::warn!(
                org_id = req.org_id,
                error = %err,
                "Briefing activity search failed"
            );
            Vec::new()
        }
    };

    let sections = build_sections(&hits);
    let summary_md = build_summary_md(&sections);
    let sources = hits.into_iter().map(hit_to_source).collect::<Vec<_>>();
    let source_count = sources.len();

    BriefingContext {
        summary_md,
        sections,
        sources,
        activity_query: query,
        source_count,
    }
}
