/// HTTP endpoints for IoT hub/device communication.
///
/// IoT hubs that cannot run an MQTT client can POST telemetry and heartbeats
/// directly over HTTP instead.
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::auth::{authorize_target, AuthError, TargetTable};
use crate::state::AppState;

// ── Request/response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
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
    /// Returned only once after successful pairing. The hub must persist this
    /// credential and present it as a Bearer token on subsequent requests.
    pub credential: Option<String>,
    pub message: String,
}

/// A single device entry in the sync payload.
#[derive(Debug, Deserialize, Serialize)]
pub struct DeviceSyncEntry {
    pub identifier: String,  // USB serial, MAC, or network address
    pub device_type: String, // "BarcodeScanner", "WeighingScale", etc.
    pub name: String,
    pub capabilities: Vec<String>,
}

/// POST /v1/devices/sync body — hub reports its full detected device list.
#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    pub hub_id: u64,
    pub devices: Vec<DeviceSyncEntry>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryRequest {
    pub device_id: u64,
    pub sensor_type: String,
    pub value: f64,
    pub raw_value: Option<String>,
    pub unit: String,
    pub quality: String,
}

#[derive(Debug, Deserialize)]
pub struct StatusRequest {
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
    headers: HeaderMap,
    Json(req): Json<HeartbeatRequest>,
) -> Result<Json<ApiResponse>, AuthError> {
    let scope = authorize_target(&state, &headers, TargetTable::Hub, req.hub_id).await?;
    let args = json!([
        scope.organization_id(),
        req.hub_id,
        req.ip_address,
        req.firmware_version,
        null,
    ]);

    state
        .call_reducer(stdb_client::reducer_call!("update_hub_heartbeat", args))
        .await
        .map_err(|e| {
            tracing::error!("Heartbeat reducer failed: {}", e);
            AuthError::internal(e.to_string())
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Heartbeat recorded".to_string(),
    }))
}

/// POST /v1/devices/telemetry — device submits a sensor reading
pub async fn telemetry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<TelemetryRequest>,
) -> Result<Json<ApiResponse>, AuthError> {
    let scope = authorize_target(&state, &headers, TargetTable::Device, req.device_id).await?;
    let args = json!([
        scope.organization_id(),
        req.device_id,
        {
            "sensor_type": req.sensor_type,
            "value": req.value,
            "raw_value": req.raw_value,
            "unit": req.unit,
            "quality": req.quality,
        }
    ]);

    state
        .call_reducer(stdb_client::reducer_call!("record_telemetry", args))
        .await
        .map_err(|e| {
            tracing::error!("record_telemetry reducer failed: {}", e);
            AuthError::internal(e.to_string())
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Telemetry recorded".to_string(),
    }))
}

/// POST /v1/pair — hub self-registers using a one-time pairing token.
///
/// No authentication required — the token itself is the proof of authorization.
/// On success the hub receives its assigned id and an opaque credential. Only
/// the credential hash is persisted in SpacetimeDB.
pub async fn pair(
    State(state): State<AppState>,
    Json(req): Json<PairRequest>,
) -> Result<Json<PairResponse>, (StatusCode, Json<PairResponse>)> {
    let mut credential_bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut credential_bytes);
    let credential = hex::encode(credential_bytes);
    let credential_hash = super::auth::credential_hash(&credential);
    let args = json!([
        req.token,
        req.serial_number,
        req.name,
        req.ip_address,
        req.firmware_version,
        credential_hash,
    ]);

    state
        .call_reducer(stdb_client::reducer_call!("claim_hub_with_token", args))
        .await
        .map_err(|e| {
            tracing::error!("claim_hub_with_token failed: {}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(PairResponse {
                    success: false,
                    hub_id: None,
                    credential: None,
                    message: e.to_string(),
                }),
            )
        })?;

    let hub = state
        .stdb
        .query_sql(&format!(
            "SELECT id FROM iot_hub WHERE credential_hash = '{}'",
            super::auth::credential_hash(&credential)
        ))
        .await
        .map_err(|error| {
            tracing::error!(%error, "paired hub lookup failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(PairResponse {
                    success: false,
                    hub_id: None,
                    credential: None,
                    message: "paired hub lookup failed".to_string(),
                }),
            )
        })?
        .into_iter()
        .next()
        .and_then(|row| {
            row.get("id")
                .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        })
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(PairResponse {
                    success: false,
                    hub_id: None,
                    credential: None,
                    message: "paired hub was not found".to_string(),
                }),
            )
        })?;
    Ok(Json(PairResponse {
        success: true,
        hub_id: Some(hub),
        credential: Some(credential),
        message: "Hub claimed successfully".to_string(),
    }))
}

/// POST /v1/devices/sync — hub reports its full detected device list.
///
/// The SpacetimeDB `sync_hub_devices` reducer diffs the list against existing
/// `IoTDevice` rows: new identifiers are created, absent ones are marked Offline.
pub async fn sync_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SyncRequest>,
) -> Result<Json<ApiResponse>, AuthError> {
    let scope = authorize_target(&state, &headers, TargetTable::Hub, req.hub_id).await?;
    let args = json!([scope.organization_id(), req.hub_id, req.devices]);

    state
        .call_reducer(stdb_client::reducer_call!("sync_hub_devices", args))
        .await
        .map_err(|e| {
            tracing::error!("sync_hub_devices failed: {}", e);
            AuthError::internal(e.to_string())
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Devices synced".to_string(),
    }))
}

/// POST /v1/devices/status — device reports online/offline change
pub async fn device_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StatusRequest>,
) -> Result<Json<ApiResponse>, AuthError> {
    let scope = authorize_target(&state, &headers, TargetTable::Device, req.device_id).await?;
    let args = json!([scope.organization_id(), req.device_id, req.status]);

    state
        .call_reducer(stdb_client::reducer_call!("update_device_status", args))
        .await
        .map_err(|e| {
            tracing::error!("update_device_status reducer failed: {}", e);
            AuthError::internal(e.to_string())
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Status updated".to_string(),
    }))
}
