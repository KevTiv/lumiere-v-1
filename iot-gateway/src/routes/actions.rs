/// HTTP endpoints for IoT action management.
///
/// The IoT gateway polls SpacetimeDB for pending IoTAction rows and dispatches
/// them to devices via MQTT. These endpoints allow hubs to acknowledge or fail
/// actions over HTTP if they don't support MQTT.
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::auth::{authorize_target, AuthError, TargetTable};
use crate::state::AppState;

// ── Request/response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AckRequest {
    pub action_id: u64,
    /// Optional result data returned by the device (e.g. weight reading, payment confirmation JSON).
    pub result_payload: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FailRequest {
    pub action_id: u64,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub success: bool,
    pub message: String,
}

// ── Route handlers ─────────────────────────────────────────────────────────

/// POST /v1/actions/ack — device confirms it received and executed an action
pub async fn ack(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AckRequest>,
) -> Result<Json<ApiResponse>, AuthError> {
    let scope = authorize_target(&state, &headers, TargetTable::Action, req.action_id).await?;
    let args = json!([scope.organization_id(), req.action_id, req.result_payload]);

    state
        .call_reducer(stdb_client::reducer_call!("acknowledge_iot_action", args))
        .await
        .map_err(|e| {
            tracing::error!("acknowledge_iot_action failed: {}", e);
            AuthError::internal(e.to_string())
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Action acknowledged".to_string(),
    }))
}

/// POST /v1/actions/fail — device reports it could not execute an action
pub async fn fail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<FailRequest>,
) -> Result<Json<ApiResponse>, AuthError> {
    let scope = authorize_target(&state, &headers, TargetTable::Action, req.action_id).await?;
    let args = json!([scope.organization_id(), req.action_id, req.error]);

    state
        .call_reducer(stdb_client::reducer_call!("fail_iot_action", args))
        .await
        .map_err(|e| {
            tracing::error!("fail_iot_action failed: {}", e);
            AuthError::internal(e.to_string())
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Action failure recorded".to_string(),
    }))
}
