/// Persistent WebSocket endpoint for IoT hub connections.
///
/// # Protocol
///
/// ## Connection
/// Hub connects with:  `GET /v1/ws?hub_id=<id>`
///
/// On upgrade the hub is registered in `AppState::hub_connections` so that
/// the action dispatcher can push `IoTAction` rows to it immediately rather
/// than waiting for the next MQTT poll cycle.
///
/// ## Gateway → Hub messages
/// Full `IoTAction` row serialised as a JSON string:
/// ```json
/// {"id":42,"device_id":7,"action_type":"SetPoint","payload":{"value":22.5},"status":"Pending",...}
/// ```
///
/// ## Hub → Gateway messages
/// ```json
/// {"type":"ack",  "organization_id":1,"action_id":42}
/// {"type":"fail", "organization_id":1,"action_id":42,"error":"device unreachable"}
/// ```
///
/// ## Disconnect
/// Hub entry is removed from `hub_connections` on any close or error.
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::state::AppState;

// ── Query param ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct HubQuery {
    pub hub_id: u64,
}

// ── Inbound message shape from hub ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct HubMessage {
    #[serde(rename = "type")]
    msg_type: String,
    organization_id: u64,
    action_id: u64,
    /// Only present for "fail" messages.
    error: Option<String>,
}

// ── Handler ────────────────────────────────────────────────────────────────

/// GET /v1/ws?hub_id=<id>
///
/// Upgrades the connection to a WebSocket and registers the hub so the action
/// dispatcher can push pending `IoTAction` rows to it immediately.
pub async fn hub_websocket(
    ws: WebSocketUpgrade,
    Query(params): Query<HubQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let hub_id = params.hub_id;
    tracing::info!("Hub {} requesting WebSocket upgrade", hub_id);
    ws.on_upgrade(move |socket| handle_hub_socket(socket, hub_id, state))
}

// ── Socket handler ─────────────────────────────────────────────────────────

/// Drive a single hub WebSocket connection.
///
/// A single `tokio::select!` loop multiplexes two event sources:
/// - Inbound frames from the hub (reducer calls)
/// - Outbound messages from the mpsc channel (action pushes from dispatcher)
///
/// When either side closes the connection the loop exits and the hub is
/// removed from `hub_connections`.
async fn handle_hub_socket(mut socket: WebSocket, hub_id: u64, state: AppState) {
    // Create the mpsc channel the dispatcher will use to push actions.
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register the sender side so `dispatch_pending_actions` can reach this hub.
    state.hub_connections.insert(hub_id, tx);
    tracing::info!("Hub {} connected via WebSocket", hub_id);

    // ── Multiplexed event loop ──────────────────────────────────────────────
    loop {
        tokio::select! {
            // Outbound: dispatcher pushed an action — forward to hub.
            maybe_msg = rx.recv() => {
                match maybe_msg {
                    Some(text) => {
                        if socket.send(Message::Text(text)).await.is_err() {
                            tracing::warn!("Hub {} socket closed on outbound send", hub_id);
                            break;
                        }
                    }
                    None => {
                        // mpsc sender was dropped — should not happen in normal
                        // operation, but exit cleanly if it does.
                        tracing::warn!("Hub {} mpsc channel closed unexpectedly", hub_id);
                        break;
                    }
                }
            }

            // Inbound: hub sent a frame — dispatch to SpacetimeDB.
            maybe_frame = socket.recv() => {
                match maybe_frame {
                    Some(Ok(Message::Text(text))) => {
                        handle_hub_message(&state, hub_id, &text).await;
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        // Some hubs send binary-encoded JSON; treat as UTF-8.
                        match std::str::from_utf8(&bytes) {
                            Ok(text) => handle_hub_message(&state, hub_id, text).await,
                            Err(_) => {
                                tracing::warn!(
                                    "Hub {} sent non-UTF8 binary frame — ignoring",
                                    hub_id
                                );
                            }
                        }
                    }
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        // axum handles ping/pong automatically; nothing to do.
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!("Hub {} closed WebSocket connection", hub_id);
                        break;
                    }
                    Some(Err(e)) => {
                        tracing::error!("Hub {} WebSocket error: {}", hub_id, e);
                        break;
                    }
                }
            }
        }
    }

    // Remove the hub from the registry so future dispatches fall back to MQTT.
    state.hub_connections.remove(&hub_id);
    tracing::info!("Hub {} WebSocket session ended", hub_id);
}

// ── Inbound message dispatch ───────────────────────────────────────────────

/// Parse a JSON message from the hub and call the appropriate SpacetimeDB reducer.
async fn handle_hub_message(state: &AppState, hub_id: u64, text: &str) {
    let msg: HubMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Hub {} sent invalid JSON ({}): {}", hub_id, e, text);
            return;
        }
    };

    match msg.msg_type.as_str() {
        "ack" => {
            let args = serde_json::json!({
                "organization_id": msg.organization_id,
                "action_id": msg.action_id,
            });
            if let Err(e) = state.call_reducer("acknowledge_iot_action", args).await {
                tracing::error!(
                    "acknowledge_iot_action failed for hub {} action {}: {}",
                    hub_id,
                    msg.action_id,
                    e
                );
            } else {
                tracing::debug!("Hub {} acknowledged action {}", hub_id, msg.action_id);
            }
        }

        "fail" => {
            let error = msg.error.unwrap_or_else(|| "unknown error".to_string());
            let args = serde_json::json!({
                "organization_id": msg.organization_id,
                "action_id": msg.action_id,
                "error": error,
            });
            if let Err(e) = state.call_reducer("fail_iot_action", args).await {
                tracing::error!(
                    "fail_iot_action failed for hub {} action {}: {}",
                    hub_id,
                    msg.action_id,
                    e
                );
            } else {
                tracing::debug!(
                    "Hub {} failed action {}: {}",
                    hub_id,
                    msg.action_id,
                    error
                );
            }
        }

        other => {
            tracing::warn!(
                "Hub {} sent unknown message type '{}' — ignoring",
                hub_id,
                other
            );
        }
    }
}
