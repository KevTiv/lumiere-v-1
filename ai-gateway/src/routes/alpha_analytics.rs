//! Deterministic, actor-scoped Alpha analytics for the chat workspace.

use axum::{extract::State, http::HeaderMap, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    harness::ActorCredentials,
    state::AppState,
    tools::{
        alpha_data::{self, ActivitySource, ReadError},
        alpha_queues, purchasing_reconciliation,
        types::{ToolContext, ToolOutput},
    },
};

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum AnalyticsRequest {
    Coverage,
    Queue {
        queue: String,
    },
    PurchasingReconciliation,
    CompareActivity {
        source: ActivitySource,
        from: String,
        through: String,
    },
}

pub async fn post_analytics(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AnalyticsRequest>,
) -> AppResult<Json<ToolOutput>> {
    let actor = lumiere_auth_context::ActorContext::from_headers(&headers)?;
    let credentials = ActorCredentials::new(actor.token, actor.identity)
        .map_err(|_| AppError::Forbidden("Authenticated actor context required".into()))?;
    let ctx = ToolContext {
        stdb: state.stdb.clone(),
        state,
        org_id: actor.organization_id,
        company_id: actor.company_id,
        run_id: 0,
        skill_key: "alpha_analytics".into(),
        config_json: Value::Null,
        inputs: Value::Null,
        allowed_action_drafts: Vec::new(),
        actor: Some(credentials),
    };

    let result = match request {
        AnalyticsRequest::Coverage => return Ok(Json(alpha_data::coverage(&ctx).await)),
        AnalyticsRequest::Queue { queue } => {
            alpha_queues::execute(&ctx, &json!({ "queue": queue })).await
        }
        AnalyticsRequest::PurchasingReconciliation => {
            purchasing_reconciliation::execute(&ctx, &json!({})).await
        }
        AnalyticsRequest::CompareActivity { source, from, through } => {
            alpha_data::compare_activity(&ctx, source, &from, &through).await
        }
    };

    result.map(Json).map_err(|error| match error.downcast_ref::<ReadError>() {
        Some(ReadError::Restricted) => AppError::Forbidden(error.to_string()),
        Some(ReadError::Incomplete) => AppError::Unavailable(error.to_string()),
        Some(ReadError::Unavailable) | None => {
            tracing::warn!(%error, "Alpha analytics operation could not complete");
            AppError::Unavailable("The authorized analysis could not be completed".into())
        }
    })
}
