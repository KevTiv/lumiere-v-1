//! Transport diagnostics live outside the certified answer implementation.

use axum::{extract::State, response::IntoResponse, Json};

use crate::{
    error::AppResult,
    routes::rag::{post_rag, post_rag_stream, RagRequest, RagResponse},
    state::AppState,
};

pub async fn post_json(
    State(state): State<AppState>,
    Json(req): Json<RagRequest>,
) -> AppResult<Json<RagResponse>> {
    log_chat_request(&req);
    let Json(reply) = post_rag(State(state), Json(req)).await?;
    tracing::info!(
        stage = "chat_json_ready",
        run_id = ?reply.run_id,
        source_count = reply.sources.len(),
        retrieval_degraded = reply.retrieval_degraded,
        verification = ?reply.verification.as_ref().map(|verdict| verdict.outcome),
    );
    Ok(Json(reply))
}

pub async fn post_stream(
    State(state): State<AppState>,
    Json(req): Json<RagRequest>,
) -> AppResult<impl IntoResponse> {
    log_chat_request(&req);
    let stream = post_rag_stream(State(state), Json(req)).await?;
    tracing::info!(stage = "chat_stream_ready");
    Ok(stream)
}

fn log_chat_request(req: &RagRequest) {
    let explicit_record = req
        .ui_context
        .as_ref()
        .is_some_and(|context| context.explicit_record == Some(true));
    tracing::info!(
        stage = "chat_started",
        org_id = ?req.org_id,
        company_id = req.company_id,
        explicit_record
    );
}
