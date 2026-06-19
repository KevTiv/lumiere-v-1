/// POST /v1/rag — Retrieval-Augmented Generation via Qdrant + tenant AiAgent LLM
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::convert::Infallible;
use std::time::Instant;

use crate::{
    ai_agent::{
        ensure_allowed_action, ensure_model_allowed, enforce_chargeable_limits, record_ai_spend,
        resolve_agent,
        agent_allows_live_read,
    },
    error::{AppError, AppResult},
    harness::{
        fetch_live_snapshots, filter_entity_refs_by_allowed_types, format_live_context_block,
        resolve_snapshot_candidates, LiveSnapshot, RAG_MAX_LIVE_SNAPSHOTS, SnapshotUiContext,
    },
    providers::llm::LlmMessage,
    qdrant_client::SearchResult,
    rig_agent::ContextHit,
    state::AppState,
};

const RAG_MAX_CONTEXT_CHUNKS: u64 = 20;
const RAG_ORG_ACTIVITY_TOP_K: usize = 8;
const RAG_ENTITY_MATCH_BOOST: f32 = 0.15;
const RAG_MAX_INCLUDE_TYPES: usize = 8;

#[derive(Clone, Deserialize, Default)]
pub struct UiContext {
    pub route: Option<String>,
    pub module: Option<String>,
    pub active_view: Option<String>,
    pub active_tab: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub selection_summary: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub company_id: Option<u64>,
    pub at_commands: Option<Vec<String>>,
}

#[derive(Clone, Deserialize)]
pub struct RagRequest {
    pub company_id: u64,
    pub query: String,
    /// Server-injected organization scope for org-level activity retrieval (BFF only).
    pub org_id: Option<u64>,
    /// Optional: limit retrieval to specific content types
    pub include_types: Option<Vec<String>>,
    #[serde(default = "default_limit")]
    pub limit: u64,
    pub ui_context: Option<UiContext>,
    pub agent_id: Option<u64>,
    pub team_member_id: Option<u64>,
    /// Optional BFF-provided entity allowlist for live snapshot reads.
    #[serde(default)]
    pub allowed_entity_types: Vec<String>,
}

fn default_limit() -> u64 {
    RAG_MAX_CONTEXT_CHUNKS
}

fn default_source_kind() -> String {
    "memory".to_string()
}

fn default_source_trust() -> String {
    "retrieved".to_string()
}

#[derive(Serialize, Clone, Debug)]
pub struct RagSource {
    #[serde(default = "default_source_kind")]
    pub kind: String,
    #[serde(default = "default_source_trust")]
    pub trust: String,
    pub content_type: String,
    pub content_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    pub score: f32,
    pub text_snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_at: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct RagResponse {
    pub answer: String,
    pub sources: Vec<RagSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

fn format_ui_context_block(ctx: &UiContext) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();

    if let Some(route) = ctx.route.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("Route: {}", route));
    }
    if let Some(module) = ctx.module.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("Module: {}", module));
    }
    if let Some(view) = ctx.active_view.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("Active view: {}", view));
    }
    if let Some(tab) = ctx.active_tab.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("Active tab: {}", tab));
    }
    if let Some(company_id) = ctx.company_id {
        lines.push(format!("Company id: {}", company_id));
    }
    if let Some(entity_type) = ctx.entity_type.as_deref().filter(|s| !s.is_empty()) {
        let entity_id = ctx.entity_id.as_deref().unwrap_or("unknown");
        lines.push(format!("Focused entity: {} #{}", entity_type, entity_id));
    }
    if let Some(summary) = ctx.selection_summary.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("Selection: {}", summary));
    }
    if let Some(perms) = ctx.permissions.as_ref().filter(|p| !p.is_empty()) {
        lines.push(format!(
            "User permissions (informational): {}",
            perms.join(", ")
        ));
    }
    if let Some(cmds) = ctx.at_commands.as_ref().filter(|c| !c.is_empty()) {
        lines.push(format!("User @-commands: {}", cmds.join(", ")));
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

const LEGACY_SYSTEM_SUFFIX: &str = "Answer the user's question using only the provided context. Be concise and factual. If the context doesn't contain enough information, say so.";

const CONTEXT_AWARE_SYSTEM_SUFFIX: &str = "Answer the user's question using the retrieved context documents. Use the ERP UI context block only to interpret what screen or module the user is viewing - it is not a data source. Be concise and factual. If the retrieved context doesn't contain enough information, say so.";

const LIVE_SNAPSHOT_SYSTEM_SUFFIX: &str = "Answer using the provided ERP context. Live ERP snapshots are authoritative for current field values and status. Retrieved memory documents may be stale; never contradict a live snapshot. Use the ERP UI context block only to interpret what screen the user is viewing. Be concise and factual. If the context is insufficient, say so.";

fn build_user_prompt(
    retrieved_context: &str,
    live_context: Option<&str>,
    ui_block: Option<&str>,
    query: &str,
) -> String {
    let mut sections: Vec<String> = Vec::new();

    if let Some(ui) = ui_block {
        sections.push(format!(
            "Current ERP UI context (metadata — not a data source):\n{ui}"
        ));
    }

    if let Some(live) = live_context.filter(|s| !s.is_empty()) {
        sections.push(format!(
            "Live ERP snapshots (authoritative — use for current field values):\n{live}"
        ));
    }

    if !retrieved_context.trim().is_empty() {
        sections.push(format!("Retrieved memory (may be stale):\n{retrieved_context}"));
    }

    sections.push(format!("Question: {query}"));
    sections.join("\n\n")
}

#[derive(Debug, Clone)]
struct RankedSource {
    label: String,
    text: String,
    score: f32,
    rag_source: RagSource,
}

fn parse_entity_id(entity_id: &str) -> u64 {
    entity_id.parse().unwrap_or(0)
}

fn company_hit_to_ranked(hit: SearchResult) -> RankedSource {
    let label = hit.content_type.clone();
    let text = hit.text_snippet.clone();
    RankedSource {
        label: label.clone(),
        text: text.clone(),
        score: hit.score,
        rag_source: RagSource {
            kind: "memory".to_string(),
            trust: "retrieved".to_string(),
            content_type: hit.content_type,
            content_id: hit.content_id,
            entity_type: None,
            entity_id: None,
            score: hit.score,
            text_snippet: text,
            label: None,
            field: None,
            snapshot_at: None,
        },
    }
}

fn org_hit_to_ranked(hit: ContextHit) -> RankedSource {
    let label = format!("org_activity:{}", hit.entity_type);
    let text = hit.text.clone();
    RankedSource {
        label: label.clone(),
        text: text.clone(),
        score: hit.score,
        rag_source: RagSource {
            kind: "activity".to_string(),
            trust: "retrieved".to_string(),
            content_type: "org_activity".to_string(),
            content_id: parse_entity_id(&hit.entity_id),
            entity_type: Some(hit.entity_type),
            entity_id: Some(hit.entity_id),
            score: hit.score,
            text_snippet: text,
            label: None,
            field: None,
            snapshot_at: None,
        },
    }
}

fn entity_match_boost(ui: Option<&UiContext>, entity_type: &str, entity_id: &str) -> f32 {
    let Some(ctx) = ui else {
        return 0.0;
    };
    let Some(focus_type) = ctx.entity_type.as_deref().filter(|s| !s.is_empty()) else {
        return 0.0;
    };
    if !focus_type.eq_ignore_ascii_case(entity_type) {
        return 0.0;
    }
    match ctx.entity_id.as_deref().filter(|s| !s.is_empty()) {
        Some(focus_id) if focus_id == entity_id => RAG_ENTITY_MATCH_BOOST,
        None => RAG_ENTITY_MATCH_BOOST * 0.5,
        _ => 0.0,
    }
}

fn merge_retrieval_hits(
    company_hits: Vec<SearchResult>,
    org_hits: Vec<ContextHit>,
    ui_context: Option<&UiContext>,
) -> Vec<RankedSource> {
    let mut merged: Vec<RankedSource> = company_hits
        .into_iter()
        .map(company_hit_to_ranked)
        .chain(org_hits.into_iter().map(|hit| {
            let boost = entity_match_boost(ui_context, &hit.entity_type, &hit.entity_id);
            let mut ranked = org_hit_to_ranked(hit);
            ranked.score += boost;
            ranked.rag_source.score = ranked.score;
            ranked
        }))
        .collect();

    merged.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged
}

fn snapshot_ui_from(ctx: Option<&UiContext>) -> Option<SnapshotUiContext> {
    ctx.map(|c| SnapshotUiContext {
        entity_type: c.entity_type.clone(),
        entity_id: c.entity_id.clone(),
    })
}

fn live_snapshots_to_rag_sources(snapshots: &[LiveSnapshot]) -> Vec<RagSource> {
    snapshots
        .iter()
        .map(|snapshot| {
            let excerpt = serde_json::to_string(&snapshot.row).unwrap_or_default();
            let text_snippet = if excerpt.len() > 280 {
                format!("{}…", &excerpt[..280])
            } else {
                excerpt
            };
            RagSource {
                kind: "live".to_string(),
                trust: "authoritative".to_string(),
                content_type: snapshot.entity_type.clone(),
                content_id: snapshot.entity_id,
                entity_type: Some(snapshot.entity_type.clone()),
                entity_id: Some(snapshot.entity_id.to_string()),
                score: 1.0,
                text_snippet,
                label: Some(snapshot.label.clone()),
                field: None,
                snapshot_at: Some(snapshot.snapshot_at.clone()),
            }
        })
        .collect()
}

fn format_retrieved_context(sources: &[RankedSource]) -> String {
    sources
        .iter()
        .enumerate()
        .map(|(i, s)| format!("[{}] ({}) {}", i + 1, s.label, s.text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn normalized_include_types(include_types: Option<&[String]>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    for raw in include_types.unwrap_or(&[]) {
        let normalized = raw.trim().to_ascii_lowercase().replace('-', "_");
        if normalized.is_empty() || out.iter().any(|existing| existing == &normalized) {
            continue;
        }
        out.push(normalized);
        if out.len() >= RAG_MAX_INCLUDE_TYPES {
            break;
        }
    }

    out
}

pub async fn post_rag(
    State(state): State<AppState>,
    Json(req): Json<RagRequest>,
) -> AppResult<Json<RagResponse>> {
    let started = Instant::now();

    if req.query.trim().is_empty() {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    let ui_block = req
        .ui_context
        .as_ref()
        .and_then(|ctx| format_ui_context_block(ctx));
    let route_label = req
        .ui_context
        .as_ref()
        .and_then(|c| c.route.as_deref())
        .unwrap_or("-");
    let module_label = req
        .ui_context
        .as_ref()
        .and_then(|c| c.module.as_deref())
        .unwrap_or("-");

    // Embed the query (unified EmbedProvider)
    let query_vector = state
        .providers
        .embedder
        .embed(&req.query)
        .await
        .map_err(|e| AppError::Embedding(e.to_string()))?;

    // Retrieve relevant company-scoped chunks (optionally filtered by content type)
    let include_types = normalized_include_types(req.include_types.as_deref());
    let content_type_filter = (!include_types.is_empty()).then_some(include_types.as_slice());
    let company_hits = state
        .vector_store
        .search_content_types(
            query_vector,
            req.company_id,
            content_type_filter,
            req.limit,
            Some(0.65),
        )
        .await
        .map_err(AppError::Qdrant)?;

    let org_top_k = req.limit.clamp(1, RAG_ORG_ACTIVITY_TOP_K as u64) as usize;
    let org_hits = if let Some(org_id) = req.org_id {
        match state
            .rig
            .search_org(org_id, req.query.trim(), org_top_k)
            .await
        {
            Ok(hits) => hits,
            Err(err) => {
                tracing::warn!(
                    org_id,
                    company_id = req.company_id,
                    error = %err,
                    "Org activity retrieval failed; continuing with company hits only"
                );
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    let company_hit_count = company_hits.len();
    let org_hit_count = org_hits.len();

    let org_id = req.org_id.ok_or_else(|| {
        AppError::BadRequest("org_id is required for RAG generation".into())
    })?;

    let agent = resolve_agent(
        &state.stdb,
        org_id,
        req.agent_id,
        req.team_member_id,
    )
    .await
    .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let allowed_types = (!req.allowed_entity_types.is_empty())
        .then_some(req.allowed_entity_types.as_slice());
    let snapshot_candidates = filter_entity_refs_by_allowed_types(
        resolve_snapshot_candidates(
            snapshot_ui_from(req.ui_context.as_ref()).as_ref(),
            &company_hits,
            &org_hits,
            RAG_MAX_LIVE_SNAPSHOTS,
        ),
        allowed_types,
    );

    let live_snapshots = if agent_allows_live_read(&agent) {
        fetch_live_snapshots(
            &state.stdb,
            org_id,
            req.company_id,
            &snapshot_candidates,
        )
        .await
        .unwrap_or_else(|err| {
            tracing::warn!(
                company_id = req.company_id,
                org_id,
                error = %err,
                "Live snapshot fetch failed; continuing with memory retrieval only"
            );
            Vec::new()
        })
    } else {
        tracing::debug!(
            agent_id = agent.agent_id,
            "Agent lacks live_read permission; skipping live snapshots"
        );
        Vec::new()
    };

    let live_snapshot_count = live_snapshots.len();
    let ranked = merge_retrieval_hits(company_hits, org_hits, req.ui_context.as_ref());

    if ranked.is_empty() && live_snapshots.is_empty() {
        tracing::info!(
            company_id = req.company_id,
            org_id,
            route = route_label,
            module = module_label,
            company_hit_count,
            org_hit_count,
            live_snapshot_count = 0,
            source_count = 0,
            duration_ms = started.elapsed().as_millis() as u64,
            "RAG query answered (no hits)"
        );
        return Ok(Json(RagResponse {
            answer: "No relevant information found for your query.".to_string(),
            sources: vec![],
            agent_id: None,
            provider: None,
            model: None,
        }));
    }

    ensure_allowed_action(&agent, "chat")
        .map_err(|e| AppError::Forbidden(e.to_string()))?;
    ensure_model_allowed(&agent)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    enforce_chargeable_limits(state.agent_rate_limiter.as_ref(), org_id, &agent)
        .map_err(|e| e.into_app_error())?;

    let retrieved_context = format_retrieved_context(&ranked);
    let live_context = if live_snapshots.is_empty() {
        None
    } else {
        Some(format_live_context_block(&live_snapshots))
    };

    let context_suffix = if live_context.is_some() {
        LIVE_SNAPSHOT_SYSTEM_SUFFIX
    } else if ui_block.is_some() {
        CONTEXT_AWARE_SYSTEM_SUFFIX
    } else {
        LEGACY_SYSTEM_SUFFIX
    };
    let system_prompt = format!("{}\n\n{}", agent.system_prompt, context_suffix);

    let user_content = build_user_prompt(
        &retrieved_context,
        live_context.as_deref(),
        ui_block.as_deref(),
        &req.query,
    );

    let llm_resp = state
        .providers
        .llm
        .complete(crate::providers::llm::LlmRequest {
            provider: agent.provider.clone(),
            model: agent.model.clone(),
            system: system_prompt,
            messages: vec![LlmMessage {
                role: "user".to_string(),
                content: user_content,
            }],
            max_tokens: agent.max_tokens,
            temperature: Some(agent.temperature),
            top_p: Some(agent.top_p),
        })
        .await
        .map_err(|e| AppError::Internal(format!("LLM request failed: {e}")))?;

    let total_tokens = llm_resp.input_tokens + llm_resp.output_tokens;
    if total_tokens > 0 {
        if let Err(e) = record_ai_spend(&state.stdb, org_id, agent.agent_id, total_tokens).await {
            tracing::warn!(
                agent_id = agent.agent_id,
                error = %e,
                "record_ai_spend failed"
            );
        }
    }

    let answer = llm_resp.text;
    let provider = Some(llm_resp.provider);
    let model = Some(llm_resp.model);
    let agent_id = Some(agent.agent_id);

    let mut sources: Vec<RagSource> = live_snapshots_to_rag_sources(&live_snapshots);
    sources.extend(ranked.into_iter().map(|s| s.rag_source));

    tracing::info!(
        company_id = req.company_id,
        org_id,
        route = route_label,
        module = module_label,
        company_hit_count,
        org_hit_count,
        live_snapshot_count,
        source_count = sources.len(),
        duration_ms = started.elapsed().as_millis() as u64,
        "RAG query answered"
    );

    Ok(Json(RagResponse {
        answer,
        sources,
        agent_id,
        provider,
        model,
    }))
}

pub async fn post_rag_stream(
    State(state): State<AppState>,
    Json(req): Json<RagRequest>,
) -> AppResult<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>> {
    let Json(response) = post_rag(State(state), Json(req)).await?;
    let mut events: Vec<Event> = Vec::new();

    for chunk in response.answer.split_inclusive(' ') {
        if !chunk.is_empty() {
            events.push(Event::default().event("delta").data(chunk.to_string()));
        }
    }

    events.push(
        Event::default()
            .event("sources")
            .data(
                json!({
                    "sources": response.sources,
                    "agent_id": response.agent_id,
                    "provider": response.provider,
                    "model": response.model,
                })
                .to_string(),
            ),
    );
    events.push(Event::default().event("done").data("{}"));

    Ok(Sse::new(stream::iter(
        events.into_iter().map(Ok::<Event, Infallible>),
    ))
    .keep_alive(KeepAlive::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_context_block_includes_route_and_module() {
        let ctx = UiContext {
            route: Some("/sales".into()),
            module: Some("sales".into()),
            active_view: Some("sales".into()),
            active_tab: Some("orders".into()),
            ..Default::default()
        };
        let block = format_ui_context_block(&ctx).expect("block");
        assert!(block.contains("Route: /sales"));
        assert!(block.contains("Module: sales"));
        assert!(block.contains("Active view: sales"));
        assert!(block.contains("Active tab: orders"));
    }

    #[test]
    fn user_prompt_separates_ui_live_and_retrieved_context() {
        let prompt = build_user_prompt(
            "[1] (invoice) Example",
            Some("[L1] Sale order #42 (as of 2026-01-01T00:00:00Z)\n{\"state\":\"sale\"}"),
            Some("Route: /sales\nModule: sales"),
            "What is this?",
        );
        assert!(prompt.contains("Current ERP UI context"));
        assert!(prompt.contains("Live ERP snapshots"));
        assert!(prompt.contains("Retrieved memory"));
        assert!(prompt.contains("Question: What is this?"));
    }

    #[test]
    fn user_prompt_memory_only_omits_live_block() {
        let prompt = build_user_prompt("[1] (invoice) Example", None, None, "What is this?");
        assert!(prompt.contains("Retrieved memory"));
        assert!(!prompt.contains("Live ERP snapshots"));
        assert!(!prompt.contains("Current ERP UI context"));
        assert!(prompt.contains("Question: What is this?"));
    }

    #[test]
    fn merge_retrieval_orders_by_score_and_boosts_entity_match() {
        let company = vec![SearchResult {
            score: 0.7,
            company_id: 1,
            content_type: "invoice".into(),
            content_id: 10,
            stdb_embedding_id: 1,
            text_snippet: "Company invoice".into(),
        }];
        let org = vec![ContextHit {
            score: 0.68,
            entity_type: "sale_order".into(),
            entity_id: "42".into(),
            text: "Order shipped".into(),
            timestamp: 0,
            source: "erp_activity".into(),
        }];
        let ui = UiContext {
            entity_type: Some("sale_order".into()),
            entity_id: Some("42".into()),
            ..Default::default()
        };
        let merged = merge_retrieval_hits(company, org, Some(&ui));
        assert_eq!(merged.len(), 2);
        assert_eq!(
            merged[0].rag_source.entity_type.as_deref(),
            Some("sale_order")
        );
        assert!(merged[0].score >= 0.83);
    }

    #[test]
    fn org_hit_maps_to_rag_source_with_parsed_entity_id() {
        let ranked = org_hit_to_ranked(ContextHit {
            score: 0.9,
            entity_type: "sale_order".into(),
            entity_id: "42".into(),
            text: "Delayed picking".into(),
            timestamp: 0,
            source: "erp_activity".into(),
        });
        assert_eq!(ranked.rag_source.content_type, "org_activity");
        assert_eq!(ranked.rag_source.entity_type.as_deref(), Some("sale_order"));
        assert_eq!(ranked.rag_source.entity_id.as_deref(), Some("42"));
        assert_eq!(ranked.rag_source.content_id, 42);
        assert_eq!(ranked.rag_source.kind, "activity");
        assert_eq!(ranked.rag_source.trust, "retrieved");
        assert!(ranked.label.contains("org_activity"));
    }

    #[test]
    fn live_snapshots_map_to_authoritative_sources() {
        let sources = live_snapshots_to_rag_sources(&[LiveSnapshot {
            entity_type: "sale_order".into(),
            entity_id: 42,
            label: "Sale order #42".into(),
            snapshot_at: "2026-06-12T12:00:00Z".into(),
            row: serde_json::json!({"state": "sale"}),
            relations: vec![],
        }]);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].kind, "live");
        assert_eq!(sources[0].trust, "authoritative");
        assert_eq!(sources[0].label.as_deref(), Some("Sale order #42"));
    }

    #[test]
    fn normalized_include_types_dedupes_and_limits_filters() {
        let include_types = vec![
            " Product ".to_string(),
            "product".to_string(),
            "sale-order".to_string(),
            "".to_string(),
            "contact".to_string(),
        ];

        let normalized = normalized_include_types(Some(&include_types));

        assert_eq!(normalized, vec!["product", "sale_order", "contact"]);
    }
}
