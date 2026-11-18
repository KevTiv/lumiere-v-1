//! Actor-owned AI indexing queue endpoints (AIH-30).
//!
//! Every handler resolves the caller's own session; a caller can lease and
//! report only jobs recorded for that same identity and organization.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header::CACHE_CONTROL, HeaderValue, Request},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    ai_index_queue::{self, JobReport, MAX_BATCH},
    cold_tier::pg_pool,
    error::ApiError,
    query_exec::resolve_membership_company_id,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ai/index-jobs/claim", post(claim))
        .route("/ai/index-jobs/report", post(report))
        .route("/ai/index-jobs/status", get(status))
        .route_layer(middleware::from_fn(no_store))
}

async fn no_store(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn pool() -> Result<&'static deadpool_postgres::Pool, ApiError> {
    pg_pool::shared_pool()
        .ok_or_else(|| ApiError::Unavailable("AI indexing queue is unavailable".into()))
}

fn actor_context(
    state: &AppState,
    session: &crate::session::ApiSession,
) -> Result<TrustedOperationContext, ApiError> {
    let context = TrustedOperationContext::for_resource_read(state, session)?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(context)
}

async fn claim(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let context = actor_context(&state, &session)?;
    let jobs = ai_index_queue::claim_for_actor(
        pool()?,
        context.organization_id(),
        context.actor_identity(),
        MAX_BATCH,
    )
    .await
    .map_err(|_| ApiError::Unavailable("AI indexing queue is unavailable".into()))?;
    Ok(Json(json!({ "jobs": jobs })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReportBody {
    outcomes: Vec<JobReport>,
}

async fn report(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<ReportBody>,
) -> Result<Json<Value>, ApiError> {
    if body.outcomes.is_empty() || body.outcomes.len() > MAX_BATCH {
        return Err(ApiError::BadRequest(
            "report one to eight indexing outcomes".into(),
        ));
    }
    let context = actor_context(&state, &session)?;
    let applied = ai_index_queue::report(
        pool()?,
        context.organization_id(),
        context.actor_identity(),
        &body.outcomes,
    )
    .await
    .map_err(|_| ApiError::Unavailable("AI indexing queue is unavailable".into()))?;
    Ok(Json(json!({ "applied": applied })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusQuery {
    company_id: u64,
}

async fn status(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StatusQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    if query.company_id == 0 {
        return Err(ApiError::BadRequest("Company ID must be positive".into()));
    }
    let context = actor_context(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        Some(query.company_id),
        "Indexing status company scope mismatch",
    )
    .await?;
    if company_id != query.company_id {
        return Err(ApiError::Forbidden(
            "Indexing status company scope mismatch".into(),
        ));
    }
    let summary = ai_index_queue::summary(pool()?, context.organization_id(), company_id)
        .await
        .map_err(|_| ApiError::Unavailable("AI indexing queue is unavailable".into()))?;
    Ok(Json(json!(summary)))
}
