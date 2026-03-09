/// HTTP endpoints for IoT hub/device communication.
///
/// IoT hubs that cannot run an MQTT client can POST telemetry and heartbeats
/// directly over HTTP instead.
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::state::AppState;

// ── Request/response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
    pub organization_id: u64,
    pub hub_id: u64,
    pub ip_address: Option<String>,
    pub firmware_version: Option<String>,
}

/// POST /v1/pair body — sent by the hub box during initial setup.
/// The token was generated via the ERP UI and entered into the hub.
#[derive(Debug, Deserialize)]
pub struct PairRequest {
    pub token: String,
    pub serial_number: String,
    pub name: String,
    pub ip_address: Option<String>,
    pub firmware_version: Option<String>,
}

/// Response to a successful pairing — the hub stores its assigned hub_id.
#[derive(Debug, Serialize)]
pub struct PairResponse {
    pub success: bool,
    pub hub_id: Option<u64>,
    pub message: String,
}

/// A single device entry in the sync payload.
#[derive(Debug, Deserialize, Serialize)]
pub struct DeviceSyncEntry {
    pub identifier: String,   // USB serial, MAC, or network address
    pub device_type: String,  // "BarcodeScanner", "WeighingScale", etc.
    pub name: String,
    pub capabilities: Vec<String>,
}

/// POST /v1/devices/sync body — hub reports its full detected device list.
#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    pub organization_id: u64,
    pub hub_id: u64,
    pub devices: Vec<DeviceSyncEntry>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryRequest {
    pub organization_id: u64,
    pub device_id: u64,
    pub sensor_type: String,
    pub value: f64,
    pub raw_value: Option<String>,
    pub unit: String,
    pub quality: String,
}

#[derive(Debug, Deserialize)]
pub struct StatusRequest {
    pub organization_id: u64,
    pub device_id: u64,
    pub status: String, // "Online" | "Offline" | "Error" | "Pairing"
}

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub success: bool,
    pub message: String,
}

// ── Route handlers ─────────────────────────────────────────────────────────

/// POST /v1/devices/heartbeat — hub reports it is alive
pub async fn heartbeat(
    State(state): State<AppState>,
    Json(req): Json<HeartbeatRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    let args = json!({
        "organization_id": req.organization_id,
        "hub_id": req.hub_id,
        "ip_address": req.ip_address,
        "firmware_version": req.firmware_version,
    });

    state
        .call_reducer("update_hub_heartbeat", args)
        .await
        .map_err(|e| {
            tracing::error!("Heartbeat reducer failed: {}", e);
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
        message: "Heartbeat recorded".to_string(),
    }))
}

/// POST /v1/devices/telemetry — device submits a sensor reading
pub async fn telemetry(
    State(state): State<AppState>,
    Json(req): Json<TelemetryRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    let args = json!({
        "organization_id": req.organization_id,
        "device_id": req.device_id,
        "params": {
            "sensor_type": req.sensor_type,
            "value": req.value,
            "raw_value": req.raw_value,
            "unit": req.unit,
            "quality": req.quality,
        }
    });

    state
        .call_reducer("record_telemetry", args)
        .await
        .map_err(|e| {
            tracing::error!("record_telemetry reducer failed: {}", e);
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
        message: "Telemetry recorded".to_string(),
    }))
}

/// POST /v1/pair — hub self-registers using a one-time pairing token.
///
/// No authentication required — the token itself is the proof of authorization.
/// On success the hub receives its assigned `hub_id` which it must include in
/// all subsequent requests.
pub async fn pair(
    State(state): State<AppState>,
    Json(req): Json<PairRequest>,
) -> Result<Json<PairResponse>, (StatusCode, Json<PairResponse>)> {
    let args = json!({
        "token": req.token,
        "serial_number": req.serial_number,
        "name": req.name,
        "ip_address": req.ip_address,
        "firmware_version": req.firmware_version,
    });

    state
        .call_reducer("claim_hub_with_token", args)
        .await
        .map_err(|e| {
            tracing::error!("claim_hub_with_token failed: {}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(PairResponse {
                    success: false,
                    hub_id: None,
                    message: e.to_string(),
                }),
            )
        })?;

    // SpacetimeDB reducers don't return data, so we can't get the hub_id
    // directly. The hub must query for its own row via the WebSocket
    // subscription after pairing (filter iot_hub by serial_number).
    Ok(Json(PairResponse {
        success: true,
        hub_id: None,
        message: "Hub claimed successfully. Connect via WebSocket to get hub_id.".to_string(),
    }))
}

/// POST /v1/devices/sync — hub reports its full detected device list.
///
/// The SpacetimeDB `sync_hub_devices` reducer diffs the list against existing
/// `IoTDevice` rows: new identifiers are created, absent ones are marked Offline.
pub async fn sync_devices(
    State(state): State<AppState>,
    Json(req): Json<SyncRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    let args = json!({
        "organization_id": req.organization_id,
        "hub_id": req.hub_id,
        "devices": req.devices,
    });

    state
        .call_reducer("sync_hub_devices", args)
        .await
        .map_err(|e| {
            tracing::error!("sync_hub_devices failed: {}", e);
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
        message: "Devices synced".to_string(),
    }))
}

/// POST /v1/devices/status — device reports online/offline change
pub async fn device_status(
    State(state): State<AppState>,
    Json(req): Json<StatusRequest>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    let args = json!({
        "organization_id": req.organization_id,
        "device_id": req.device_id,
        "status": req.status,
    });

    state
        .call_reducer("update_device_status", args)
        .await
        .map_err(|e| {
            tracing::error!("update_device_status reducer failed: {}", e);
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
        message: "Status updated".to_string(),
    }))
}
