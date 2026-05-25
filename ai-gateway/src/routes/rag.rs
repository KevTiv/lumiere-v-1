/// POST /v1/rag — Retrieval-Augmented Generation via Qdrant + Claude
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
    error::{AppError, AppResult},
    qdrant_client::SearchResult,
    rig_agent::ContextHit,
    state::AppState,
};

const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL: &str = "claude-sonnet-4-6";
const RAG_MAX_CONTEXT_CHUNKS: u64 = 20;
const RAG_MAX_TOKENS: u32 = 2048;
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
}

fn default_limit() -> u64 {
    RAG_MAX_CONTEXT_CHUNKS
}

#[derive(Serialize, Clone, Debug)]
pub struct RagSource {
    pub content_type: String,
    pub content_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    pub score: f32,
    pub text_snippet: String,
}

#[derive(Clone, Serialize)]
pub struct RagResponse {
    pub answer: String,
    pub sources: Vec<RagSource>,
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

const LEGACY_SYSTEM_PROMPT: &str =
    "You are an intelligent ERP assistant. Answer the user's question using only the provided context. Be concise and factual. If the context doesn't contain enough information, say so.";

const CONTEXT_AWARE_SYSTEM_PROMPT: &str = "You are an intelligent ERP assistant. Answer the user's question using the retrieved context documents. Use the ERP UI context block only to interpret what screen or module the user is viewing - it is not a data source. Be concise and factual. If the retrieved context doesn't contain enough information, say so.";

fn build_user_prompt(retrieved_context: &str, ui_block: Option<&str>, query: &str) -> String {
    match ui_block {
        Some(ui) => format!(
            "Current ERP UI context (factual metadata - not retrieved documents):\n{ui}\n\nRetrieved context:\n{retrieved_context}\n\nQuestion: {query}"
        ),
        None => format!("Context:\n{retrieved_context}\n\nQuestion: {query}"),
    }
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
            content_type: hit.content_type,
            content_id: hit.content_id,
            entity_type: None,
            entity_id: None,
            score: hit.score,
            text_snippet: text,
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
            content_type: "org_activity".to_string(),
            content_id: parse_entity_id(&hit.entity_id),
            entity_type: Some(hit.entity_type),
            entity_id: Some(hit.entity_id),
            score: hit.score,
            text_snippet: text,
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
    let system_prompt = if ui_block.is_some() {
        CONTEXT_AWARE_SYSTEM_PROMPT
    } else {
        LEGACY_SYSTEM_PROMPT
    };
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

    // Embed the query
    let query_vector = state
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
    let ranked = merge_retrieval_hits(company_hits, org_hits, req.ui_context.as_ref());

    if ranked.is_empty() {
        tracing::info!(
            company_id = req.company_id,
            org_id = req.org_id.unwrap_or(0),
            route = route_label,
            module = module_label,
            company_hit_count,
            org_hit_count,
            source_count = 0,
            duration_ms = started.elapsed().as_millis() as u64,
            "RAG query answered (no hits)"
        );
        return Ok(Json(RagResponse {
            answer: "No relevant information found for your query.".to_string(),
            sources: vec![],
        }));
    }

    // Build context string from merged company + org retrieval
    let context = format_retrieved_context(&ranked);

    let user_content = build_user_prompt(&context, ui_block.as_deref(), &req.query);

    // Call Claude API with retrieved context and UI metadata
    let claude_payload = json!({
        "model": CLAUDE_MODEL,
        "max_tokens": RAG_MAX_TOKENS,
        "system": system_prompt,
        "messages": [
            {
                "role": "user",
                "content": user_content
            }
        ]
    });

    let claude_resp = state
        .http
        .post(CLAUDE_API_URL)
        .header("x-api-key", state.config.anthropic_api_key.as_str())
        .header("anthropic-version", "2023-06-01")
        .json(&claude_payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Claude API request failed: {}", e)))?;

    if !claude_resp.status().is_success() {
        let status = claude_resp.status();
        let body = claude_resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Claude API error {}: {}",
            status, body
        )));
    }

    let claude_body: serde_json::Value = claude_resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Claude response: {}", e)))?;

    let answer = claude_body["content"][0]["text"]
        .as_str()
        .unwrap_or("No answer generated.")
        .to_string();

    let sources: Vec<RagSource> = ranked.into_iter().map(|s| s.rag_source).collect();

    tracing::info!(
        company_id = req.company_id,
        org_id = req.org_id.unwrap_or(0),
        route = route_label,
        module = module_label,
        company_hit_count,
        org_hit_count,
        source_count = sources.len(),
        duration_ms = started.elapsed().as_millis() as u64,
        "RAG query answered"
    );

    Ok(Json(RagResponse { answer, sources }))
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
            .data(json!({ "sources": response.sources }).to_string()),
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
    fn user_prompt_separates_ui_and_retrieved_context() {
        let prompt = build_user_prompt(
            "[1] (invoice) Example",
            Some("Route: /sales\nModule: sales"),
            "What is this?",
        );
        assert!(prompt.contains("Current ERP UI context"));
        assert!(prompt.contains("Retrieved context:"));
        assert!(prompt.contains("Question: What is this?"));
    }

    #[test]
    fn user_prompt_without_ui_context_matches_legacy_format() {
        let prompt = build_user_prompt("[1] (invoice) Example", None, "What is this?");
        assert_eq!(
            prompt,
            "Context:\n[1] (invoice) Example\n\nQuestion: What is this?"
        );
        assert!(!prompt.contains("Retrieved context:"));
        assert!(!prompt.contains("Current ERP UI context"));
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
        assert!(ranked.label.contains("org_activity"));
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
