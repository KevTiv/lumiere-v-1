//! Activity context collection for the daily_briefing skill.

use serde::{Deserialize, Serialize};

use crate::{
    harness::{fetch_authorized_live_snapshots, ActorCredentials, EntityRef, LiveSnapshot},
    retrieval_policy::optional_retrieval,
    rig_agent::ContextHit,
    state::AppState,
};

const DEFAULT_BRIEFING_QUERY: &str =
    "recent ERP changes approvals import failures workflow activity notable risk";
const DEFAULT_TOP_K: usize = 8;
const MAX_TOP_K: usize = 25;

#[derive(Debug, Clone, Deserialize)]
pub struct BriefingContextRequest {
    pub org_id: u64,
    pub company_id: u64,
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
    pub retrieval_degraded: bool,
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
            req.since_micros
                .is_none_or(|since| hit.record.activity_timestamp >= since)
                && req
                    .until_micros
                    .is_none_or(|until| hit.record.activity_timestamp <= until)
                && module_allowed(&hit.record.semantic.resource_kind, &req.allowed_modules)
        })
        .collect()
}

struct ResolvedActivity {
    hit: ContextHit,
    snapshot: LiveSnapshot,
}

fn snapshot_excerpt(snapshot: &LiveSnapshot) -> String {
    let rendered = serde_json::to_string(&snapshot.row).unwrap_or_default();
    if rendered.chars().count() <= 280 {
        return rendered;
    }
    format!("{}…", rendered.chars().take(280).collect::<String>())
}

fn build_sections(activities: &[ResolvedActivity]) -> Vec<BriefingSection> {
    if activities.is_empty() {
        return Vec::new();
    }

    let mut by_entity = std::collections::BTreeMap::<String, Vec<&ResolvedActivity>>::new();
    for activity in activities {
        by_entity
            .entry(activity.snapshot.entity_type.clone())
            .or_default()
            .push(activity);
    }

    by_entity
        .into_iter()
        .map(|(entity_type, activities)| {
            let items = activities
                .iter()
                .take(5)
                .map(|activity| {
                    format!(
                        "{} #{}: {}",
                        activity.snapshot.entity_type,
                        activity.snapshot.entity_id,
                        snapshot_excerpt(&activity.snapshot)
                    )
                })
                .collect::<Vec<_>>();
            BriefingSection {
                title: entity_type.replace('_', " "),
                summary: format!("{} relevant activity item(s) found.", activities.len()),
                items,
            }
        })
        .collect()
}

fn build_summary_md(sections: &[BriefingSection], retrieval_degraded: bool) -> String {
    if sections.is_empty() {
        if retrieval_degraded {
            return "Semantic activity retrieval is temporarily unavailable. No unverified activity content was included.".to_string();
        }
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

fn activity_to_source(activity: ResolvedActivity) -> BriefingSource {
    let text_snippet = snapshot_excerpt(&activity.snapshot);
    BriefingSource {
        source_type: "erp_activity".into(),
        entity_type: activity.snapshot.entity_type,
        entity_id: activity.snapshot.entity_id.to_string(),
        score: activity.hit.score,
        text_snippet,
        timestamp: activity.hit.record.activity_timestamp,
    }
}

pub async fn collect_briefing_context(
    state: &AppState,
    actor: &ActorCredentials,
    req: BriefingContextRequest,
) -> Result<BriefingContext, String> {
    let query = req
        .activity_query
        .as_deref()
        .filter(|query| !query.trim().is_empty())
        .unwrap_or(DEFAULT_BRIEFING_QUERY)
        .to_string();
    let top_k = req.top_k.unwrap_or(DEFAULT_TOP_K).clamp(1, MAX_TOP_K);

    let search_result = state
        .rig
        .search_scope(req.org_id, req.company_id, &query, top_k)
        .await;
    if let Err(error) = &search_result {
        tracing::warn!(
            org_id = req.org_id,
            company_id = req.company_id,
            error = %error,
            "Briefing activity retrieval unavailable"
        );
    }
    let search_outcome = optional_retrieval(search_result);
    let mut retrieval_degraded = search_outcome.degraded;
    let hits = search_outcome.value;
    let hits = filter_hits(&req, hits);
    let candidates = hits
        .iter()
        .filter_map(|hit| {
            let entity_id = hit.record.semantic.resource_id.parse::<u64>().ok()?;
            (entity_id > 0).then(|| EntityRef {
                entity_type: hit.record.semantic.resource_kind.clone(),
                entity_id,
                priority: hit.score,
            })
        })
        .collect::<Vec<_>>();
    let snapshot_result =
        fetch_authorized_live_snapshots(state, actor, req.org_id, req.company_id, &candidates)
            .await;
    if let Err(error) = &snapshot_result {
        tracing::warn!(
            org_id = req.org_id,
            company_id = req.company_id,
            error = %error,
            "Briefing authoritative retrieval unavailable"
        );
    }
    let snapshot_outcome = optional_retrieval(snapshot_result);
    retrieval_degraded |= snapshot_outcome.degraded;
    let snapshots = snapshot_outcome.value;
    let snapshots = snapshots
        .into_iter()
        .map(|snapshot| ((snapshot.entity_type.clone(), snapshot.entity_id), snapshot))
        .collect::<std::collections::HashMap<_, _>>();
    let activities = hits
        .into_iter()
        .filter_map(|hit| {
            let entity_id = hit.record.semantic.resource_id.parse::<u64>().ok()?;
            let key = (hit.record.semantic.resource_kind.clone(), entity_id);
            snapshots
                .get(&key)
                .cloned()
                .map(|snapshot| ResolvedActivity { hit, snapshot })
        })
        .collect::<Vec<_>>();

    let sections = build_sections(&activities);
    let summary_md = build_summary_md(&sections, retrieval_degraded);
    let sources = activities
        .into_iter()
        .map(activity_to_source)
        .collect::<Vec<_>>();
    let source_count = sources.len();

    Ok(BriefingContext {
        summary_md,
        sections,
        sources,
        activity_query: query,
        source_count,
        retrieval_degraded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degraded_briefing_does_not_claim_there_was_no_activity() {
        let summary = build_summary_md(&[], true);
        assert!(summary.contains("temporarily unavailable"));
        assert!(!summary.contains("No recent activity was found"));
    }

    #[test]
    fn healthy_empty_briefing_reports_no_activity() {
        let summary = build_summary_md(&[], false);
        assert!(summary.contains("No recent activity was found"));
    }
}
