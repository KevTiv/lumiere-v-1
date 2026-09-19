/// POST /v1/rag — Retrieval-Augmented Generation via Qdrant + tenant AiAgent LLM
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::time::Instant;

use crate::{
    ai_agent::{
        agent_allows_live_read, enforce_chargeable_limits, ensure_allowed_action,
        ensure_model_allowed, record_ai_spend, resolve_agent,
    },
    error::{AppError, AppResult},
    harness::{
        fetch_authorized_live_snapshots, filter_entity_refs_by_allowed_types,
        format_live_context_block, resolve_snapshot_candidates, ActorCredentials, LiveSnapshot,
        SnapshotUiContext, RAG_MAX_LIVE_SNAPSHOTS,
    },
    orchestrator::text_answer_gate::{
        gate_text_answer, TextAnswerProvenance, TextAnswerVerification, TextEvidence,
    },
    providers::llm::LlmMessage,
    retrieval_policy::optional_retrieval,
    state::AppState,
    stdb_embed::company_belongs_to_organization,
};

const RAG_MAX_CONTEXT_CHUNKS: u64 = 20;
const RAG_ORG_ACTIVITY_TOP_K: usize = 8;
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
    pub stdb_token: String,
    pub identity_hex: String,
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
    pub retrieval_degraded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The §7.3 answer-gate verdict. Present whenever a model answer was
    /// produced; `answer` is then the gated text (limitations appended when
    /// qualified) or a withheld notice, never the raw candidate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification: Option<TextAnswerVerification>,
    /// Claim-level support and calculation provenance for the gated answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<TextAnswerProvenance>,
}

fn no_relevant_information_response(retrieval_degraded: bool) -> RagResponse {
    RagResponse {
        answer: "No relevant information found for your query.".to_string(),
        sources: Vec::new(),
        retrieval_degraded,
        agent_id: None,
        provider: None,
        model: None,
        verification: None,
        provenance: None,
    }
}

/// What the server established for this answer: each live snapshot it read
/// (and every number in it), plus the numbers the user typed.
fn rag_text_evidence(
    snapshots: &[LiveSnapshot],
    ranked: &[RankedSource],
    query: &str,
) -> TextEvidence {
    let mut evidence = TextEvidence::default();
    for snapshot in snapshots {
        evidence.add_ref(
            "live_snapshot",
            format!("{}:{}", snapshot.entity_type, snapshot.entity_id),
        );
        evidence.add_json(&snapshot.row);
        for relation in &snapshot.relations {
            for row in &relation.rows {
                evidence.add_json(row);
            }
        }
    }
    for source in ranked {
        evidence.add_ref(
            "memory",
            format!(
                "{}:{}",
                source.rag_source.content_type, source.rag_source.content_id
            ),
        );
    }
    evidence.add_user_text(query);
    evidence
}

/// §7.3: the candidate is not an answer until the gate has judged it. A
/// qualified answer carries its limitations; an unverified one is replaced by a
/// withheld notice, and neither `post_rag_stream` nor any client ever sees the
/// raw candidate.
async fn finalize_rag_answer(
    org_id: u64,
    company_id: u64,
    candidate: &str,
    snapshots: &[LiveSnapshot],
    ranked: &[RankedSource],
    query: &str,
) -> anyhow::Result<(String, TextAnswerVerification, TextAnswerProvenance)> {
    let gated = gate_text_answer(
        org_id,
        company_id,
        candidate,
        &rag_text_evidence(snapshots, ranked, query),
    )
    .await?;
    let answer = gated
        .released
        .clone()
        .unwrap_or_else(|| gated.withheld_notice());
    Ok((answer, gated.verification, gated.provenance))
}

/// The pieces the SSE stream replays. Built only from the gated answer, so a
/// withheld candidate can never reach a `delta` event.
fn answer_chunks(answer: &str) -> Vec<String> {
    answer
        .split_inclusive(' ')
        .filter(|chunk| !chunk.is_empty())
        .map(str::to_string)
        .collect()
}

fn has_grounded_context(ranked: &[RankedSource], snapshots: &[LiveSnapshot]) -> bool {
    !ranked.is_empty() || !snapshots.is_empty()
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

const STRUCTURED_ANSWER_SUFFIX: &str = r#"Return only one JSON object with this shape:
{"content":"complete answer text","claims":[{"text":"an exact, non-overlapping segment of content","supportRefs":[{"kind":"live_snapshot","id":"entity_type:entity_id"}],"passageSupport":[]}],"calculations":[]}
The claim texts, concatenated in order, must cover all content. Use only support refs explicitly listed in the context. Do not cite display labels or snippets."#;

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
        sections.push(format!(
            "Retrieved memory (may be stale):\n{retrieved_context}"
        ));
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
    let actor = ActorCredentials::new(req.stdb_token.clone(), req.identity_hex.clone())
        .map_err(|error| AppError::Forbidden(error.to_string()))?;

    let org_id = req
        .org_id
        .ok_or_else(|| AppError::BadRequest("org_id is required for RAG generation".into()))?;
    let company_is_in_scope =
        company_belongs_to_organization(state.stdb.as_ref(), org_id, req.company_id)
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
    if !company_is_in_scope {
        return Err(AppError::Forbidden(
            "company does not belong to organization".into(),
        ));
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

    // Retrieve relevant company-scoped chunks (optionally filtered by content type)
    let include_types = normalized_include_types(req.include_types.as_deref());
    let content_type_filter = (!include_types.is_empty()).then_some(include_types.as_slice());
    let mut retrieval_degraded = false;
    let company_result = match state.providers.embedder.embed(&req.query).await {
        Ok(query_vector) => {
            state
                .vector_store
                .search_content_types(
                    query_vector,
                    org_id,
                    req.company_id,
                    content_type_filter,
                    req.limit,
                    Some(0.65),
                )
                .await
        }
        Err(error) => Err(error),
    };
    if let Err(error) = &company_result {
        tracing::warn!(
            org_id,
            company_id = req.company_id,
            error = %error,
            "Primary semantic retrieval unavailable; continuing without vector candidates"
        );
    }
    let company_outcome = optional_retrieval(company_result);
    retrieval_degraded |= company_outcome.degraded;
    let company_hits = company_outcome.value;

    let org_top_k = req.limit.clamp(1, RAG_ORG_ACTIVITY_TOP_K as u64) as usize;
    let org_result = state
        .rig
        .search_scope(org_id, req.company_id, req.query.trim(), org_top_k)
        .await;
    if let Err(error) = &org_result {
        tracing::warn!(
            org_id,
            company_id = req.company_id,
            error = %error,
            "Org activity retrieval unavailable; continuing with company hits only"
        );
    }
    let org_outcome = optional_retrieval(org_result);
    retrieval_degraded |= org_outcome.degraded;
    let org_hits = org_outcome.value;

    let company_hit_count = company_hits.len();
    let org_hit_count = org_hits.len();

    let agent = resolve_agent(&state.stdb, org_id, req.agent_id, req.team_member_id)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let allowed_types =
        (!req.allowed_entity_types.is_empty()).then_some(req.allowed_entity_types.as_slice());
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
        let snapshot_result = fetch_authorized_live_snapshots(
            &state,
            &actor,
            org_id,
            req.company_id,
            &snapshot_candidates,
        )
        .await;
        if let Err(error) = &snapshot_result {
            tracing::warn!(
                org_id,
                company_id = req.company_id,
                error = %error,
                "Authoritative semantic candidates unavailable; continuing without them"
            );
        }
        let snapshot_outcome = optional_retrieval(snapshot_result);
        retrieval_degraded |= snapshot_outcome.degraded;
        snapshot_outcome.value
    } else {
        tracing::debug!(
            agent_id = agent.agent_id,
            "Agent lacks live_read permission; skipping live snapshots"
        );
        Vec::new()
    };

    let live_snapshot_count = live_snapshots.len();
    // Qdrant hits rank candidates only; prompt text and citations come from
    // scoped authoritative snapshots.
    let ranked: Vec<RankedSource> = Vec::new();

    if !has_grounded_context(&ranked, &live_snapshots) {
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
        return Ok(Json(no_relevant_information_response(retrieval_degraded)));
    }

    ensure_allowed_action(&agent, "chat").map_err(|e| AppError::Forbidden(e.to_string()))?;
    ensure_model_allowed(&agent).map_err(|e| AppError::BadRequest(e.to_string()))?;
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
    let system_prompt = format!(
        "{}\n\n{}\n\n{}",
        agent.system_prompt, context_suffix, STRUCTURED_ANSWER_SUFFIX
    );

    let user_content = build_user_prompt(
        &retrieved_context,
        live_context.as_deref(),
        ui_block.as_deref(),
        &req.query,
    );
    let mut allowed_supports = live_snapshots
        .iter()
        .map(|snapshot| {
            format!(
                "live_snapshot:{}:{}",
                snapshot.entity_type, snapshot.entity_id
            )
        })
        .collect::<Vec<_>>();
    allowed_supports.extend(ranked.iter().map(|source| {
        format!(
            "memory:{}:{}",
            source.rag_source.content_type, source.rag_source.content_id
        )
    }));
    let allowed_supports = allowed_supports.join(", ");
    let user_content =
        format!("{user_content}\n\nAllowed structured support refs: {allowed_supports}");

    let llm_resp = state
        .providers
        .llm
        .complete(crate::providers::llm::LlmRequest {
            provider: agent.provider.clone(),
            model: agent.model.clone(),
            system: system_prompt,
            messages: vec![LlmMessage::text("user", user_content)],
            max_tokens: agent.max_tokens,
            temperature: Some(agent.temperature),
            top_p: Some(agent.top_p),
            tools: Vec::new(),
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

    let (answer, verification, mut provenance) = finalize_rag_answer(
        org_id,
        req.company_id,
        &llm_resp.text,
        &live_snapshots,
        &ranked,
        &req.query,
    )
    .await
    .map_err(|e| AppError::Internal(format!("answer gate failed: {e}")))?;
    provenance.mark_not_persisted(
        "RAG provenance is response-scoped; it has not been recorded as reviewed knowledge",
    );
    let verification = Some(verification);
    let provenance = Some(provenance);
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
        retrieval_degraded,
        agent_id,
        provider,
        model,
        verification,
        provenance,
    }))
}

pub async fn post_rag_stream(
    State(state): State<AppState>,
    Json(req): Json<RagRequest>,
) -> AppResult<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>> {
    let Json(response) = post_rag(State(state), Json(req)).await?;
    let mut events: Vec<Event> = Vec::new();

    for chunk in answer_chunks(&response.answer) {
        events.push(Event::default().event("delta").data(chunk));
    }

    events.push(
        Event::default()
            .event("sources")
            .data(rag_stream_metadata(&response).to_string()),
    );
    events.push(Event::default().event("done").data("{}"));

    Ok(Sse::new(stream::iter(
        events.into_iter().map(Ok::<Event, Infallible>),
    ))
    .keep_alive(KeepAlive::default()))
}

fn rag_stream_metadata(response: &RagResponse) -> Value {
    json!({
        "sources": response.sources,
        "agent_id": response.agent_id,
        "provider": response.provider,
        "model": response.model,
        "retrieval_degraded": response.retrieval_degraded,
        "verification": response.verification,
        "provenance": response.provenance,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degraded_empty_retrieval_returns_no_unverified_sources() {
        let response = no_relevant_information_response(true);
        assert!(response.retrieval_degraded);
        assert!(response.sources.is_empty());
        assert!(response.provider.is_none());
        assert!(response.model.is_none());
        assert!(!has_grounded_context(&[], &[]));
    }

    #[test]
    fn rag_evidence_is_the_live_snapshots_and_the_users_own_figures() {
        let snapshot = LiveSnapshot {
            entity_type: "sale_order".into(),
            entity_id: 42,
            label: "Sale order #42".into(),
            snapshot_at: "2026-06-12T12:00:00Z".into(),
            row: serde_json::json!({"amount_total": 1250.5}),
            relations: vec![crate::harness::snapshot::RelationSnapshot {
                relation_key: "lines".into(),
                rows: vec![serde_json::json!({"price_subtotal": 999.25})],
            }],
        };
        let evidence = rag_text_evidence(&[snapshot], &[], "Is $5,000.00 enough?");
        assert_eq!(evidence.refs.len(), 1);
        assert_eq!(evidence.refs[0].kind, "live_snapshot");
        assert_eq!(evidence.refs[0].id, "sale_order:42");
        for expected in [1250.5, 999.25, 5000.0] {
            assert!(evidence.figures.contains(&expected), "{expected}");
        }
        // No snapshots means no evidence: nothing to ground an answer in.
        assert!(rag_text_evidence(&[], &[], "hello").refs.is_empty());
    }

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
    fn snapshot_with_total(total: f64) -> LiveSnapshot {
        LiveSnapshot {
            entity_type: "sale_order".into(),
            entity_id: 42,
            label: "Sale order #42".into(),
            snapshot_at: "2026-06-12T12:00:00Z".into(),
            row: serde_json::json!({ "amount_total": total }),
            relations: vec![],
        }
    }

    #[tokio::test]
    async fn an_ungrounded_rag_candidate_is_replaced_and_never_streamed() {
        use crate::orchestrator::text_answer_gate::TextAnswerOutcome;

        let (answer, verification, provenance) = finalize_rag_answer(
            1,
            2,
            "Order #42 totals $31,415.92.",
            &[],
            &[],
            "What does order 42 total?",
        )
        .await
        .unwrap();
        assert_eq!(verification.outcome, TextAnswerOutcome::RequiresReview);
        assert!(!provenance.persisted);
        assert!(!answer.contains("31,415.92"), "{answer}");
        // The stream is built from the returned answer, so the candidate text
        // cannot appear in any delta.
        let streamed: String = answer_chunks(&answer).concat();
        assert_eq!(streamed, answer);
        assert!(!streamed.contains("31,415.92"));

        let response = RagResponse {
            answer,
            sources: Vec::new(),
            retrieval_degraded: false,
            agent_id: Some(1),
            provider: Some("test".into()),
            model: Some("test".into()),
            verification: Some(verification),
            provenance: Some(provenance),
        };
        let json_response = serde_json::to_string(&response).unwrap();
        let sse_metadata = rag_stream_metadata(&response).to_string();
        assert!(!json_response.contains("31,415.92"), "{json_response}");
        assert!(!sse_metadata.contains("31,415.92"), "{sse_metadata}");
    }

    #[tokio::test]
    async fn unstructured_rag_prose_is_withheld_even_with_live_data() {
        use crate::orchestrator::text_answer_gate::TextAnswerOutcome;

        let snapshots = [snapshot_with_total(1250.5)];
        let (answer, verification, provenance) = finalize_rag_answer(
            1,
            2,
            "Order #42 totals $1,250.50.",
            &snapshots,
            &[],
            "Order 42 total?",
        )
        .await
        .unwrap();
        assert_eq!(verification.outcome, TextAnswerOutcome::RequiresReview);
        assert!(answer.contains("withheld"));
        assert!(provenance.claims.is_empty());

        let (answer, verification, _) = finalize_rag_answer(
            1,
            2,
            "Order #42 totals $9,999.99.",
            &snapshots,
            &[],
            "Order 42 total?",
        )
        .await
        .unwrap();
        assert_eq!(verification.outcome, TextAnswerOutcome::RequiresReview);
        assert!(answer.contains("withheld"), "{answer}");
    }

    #[tokio::test]
    async fn a_server_resolved_memory_ref_can_ground_document_only_rag() {
        use crate::orchestrator::text_answer_gate::TextAnswerOutcome;

        let ranked = [RankedSource {
            label: "Policy passage".into(),
            text: "Returns require approval.".into(),
            score: 0.9,
            rag_source: RagSource {
                kind: "memory".into(),
                trust: "retrieved".into(),
                content_type: "policy".into(),
                content_id: 7,
                entity_type: None,
                entity_id: None,
                score: 0.9,
                text_snippet: "Returns require approval.".into(),
                label: Some("Policy passage".into()),
                field: None,
                snapshot_at: None,
            },
        }];
        let candidate = json!({
            "content": "Returns require approval.",
            "claims": [{
                "text": "Returns require approval.",
                "supportRefs": [{"kind": "memory", "id": "policy:7"}],
                "passageSupport": []
            }],
            "calculations": []
        })
        .to_string();

        let (answer, verification, provenance) =
            finalize_rag_answer(1, 2, &candidate, &[], &ranked, "What is the returns rule?")
                .await
                .unwrap();

        assert_eq!(verification.outcome, TextAnswerOutcome::Admitted);
        assert_eq!(answer, "Returns require approval.");
        assert_eq!(provenance.citations[0].id, "policy:7");
        assert!(!provenance.persisted);
    }

    #[test]
    fn answer_chunks_reassemble_the_answer_exactly() {
        for answer in [
            "",
            "one",
            "two words",
            "  padded  text here ",
            "line\nbreak ok",
        ] {
            assert_eq!(answer_chunks(answer).concat(), answer);
        }
    }
}
