/// HTTP endpoints for IoT action management.
///
/// The IoT gateway polls SpacetimeDB for pending IoTAction rows and dispatches
/// them to devices via MQTT. These endpoints allow hubs to acknowledge or fail
/// actions over HTTP if they don't support MQTT.
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::state::AppState;

// ── Request/response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AckRequest {
    pub organization_id: u64,
    pub action_id: u64,
    /// Optional result data returned by the device (e.g. weight reading, payment confirmation JSON).
    pub result_payload: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FailRequest {
    pub organization_id: u64,
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
    Json(req): Json<AckRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    let args = json!({
        "organization_id": req.organization_id,
        "action_id": req.action_id,
        "result_payload": req.result_payload,
    });

    state
        .call_reducer("acknowledge_iot_action", args)
        .await
        .map_err(|e| {
            tracing::error!("acknowledge_iot_action failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse {
                    success: false,
                    message: e.to_string(),
                }),
            )
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Action acknowledged".to_string(),
    }))
}

/// POST /v1/actions/fail — device reports it could not execute an action
pub async fn fail(
    State(state): State<AppState>,
    Json(req): Json<FailRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    let args = json!({
        "organization_id": req.organization_id,
        "action_id": req.action_id,
        "error": req.error,
    });

    state
        .call_reducer("fail_iot_action", args)
        .await
        .map_err(|e| {
            tracing::error!("fail_iot_action failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse {
                    success: false,
                    message: e.to_string(),
                }),
            )
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Action failure recorded".to_string(),
    }))
}
