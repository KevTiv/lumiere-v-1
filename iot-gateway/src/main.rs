/// Lumiere IoT Gateway
///
/// Bridges physical IoT devices to the SpacetimeDB ERP module.
///
/// # Responsibilities
/// 1. **MQTT bridge** — subscribes to `iot/+/telemetry` and `iot/+/status`,
///    forwards events to SpacetimeDB reducers via REST.
/// 2. **Action dispatcher** — polls SpacetimeDB for pending IoTAction rows
///    and delivers them to connected hubs.  Delivery is WS-first:
///    - If the hub that owns the action's device has an active WebSocket
///      connection, the action is pushed immediately over that connection.
///    - If the hub is not connected via WebSocket, the action is published to
///      the `iot/<device_id>/action` MQTT topic as a fallback so that hubs
///      that do not support WebSocket are still served.
/// 3. **HTTP API** — for hubs that prefer HTTP over MQTT:
///    - POST /v1/devices/heartbeat
///    - POST /v1/devices/telemetry
///    - POST /v1/devices/status
///    - POST /v1/actions/ack
///    - POST /v1/actions/fail
/// 4. **WebSocket endpoint** — for hubs that support persistent connections:
///    - GET /v1/ws?hub_id=<id>
use std::time::Duration;

use axum::{routing::{get, post}, Router};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use tokio::time;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod config;
mod routes;
mod state;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── Load environment ──────────────────────────────────────────────────
    dotenvy::dotenv().ok();

    // ── Logging ───────────────────────────────────────────────────────────
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // ── Config ────────────────────────────────────────────────────────────
    let config = Config::from_env()?;
    let port = config.port;
    let action_poll_secs = config.action_poll_secs;

    tracing::info!(
        "Starting Lumiere IoT Gateway on port {} — MQTT {}:{}",
        port,
        config.mqtt_host,
        config.mqtt_port
    );

    // ── MQTT client ───────────────────────────────────────────────────────
    let mut mqtt_options = MqttOptions::new(
        &config.mqtt_client_id,
        &config.mqtt_host,
        config.mqtt_port,
    );
    mqtt_options.set_keep_alive(Duration::from_secs(30));
    mqtt_options.set_clean_session(true);

    if let (Some(user), Some(pass)) = (&config.mqtt_username, &config.mqtt_password) {
        mqtt_options.set_credentials(user, pass);
    }

    let (mqtt_client, mut event_loop) = AsyncClient::new(mqtt_options, 100);

    // Subscribe to device topics
    mqtt_client
        .subscribe("iot/+/telemetry", QoS::AtLeastOnce)
        .await?;
    mqtt_client
        .subscribe("iot/+/status", QoS::AtLeastOnce)
        .await?;

    tracing::info!("MQTT subscribed to iot/+/telemetry and iot/+/status");

    // ── Shared state ──────────────────────────────────────────────────────
    let state = AppState::new(config, mqtt_client);

    // ── Spawn MQTT event loop ─────────────────────────────────────────────
    let state_for_mqtt = state.clone();
    tokio::spawn(async move {
        loop {
            match event_loop.poll().await {
                Ok(Event::Incoming(Packet::Publish(msg))) => {
                    handle_mqtt_message(&state_for_mqtt, &msg.topic, &msg.payload).await;
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!("MQTT error: {} — reconnecting in 5s", e);
                    time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    });

    // ── Spawn action dispatcher ───────────────────────────────────────────
    // The dispatcher runs on a fixed interval as a safety net.  Actions
    // destined for WebSocket-connected hubs are pushed immediately via the
    // WS channel; actions whose hub is not connected fall back to MQTT.
    let state_for_dispatcher = state.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(action_poll_secs));
        loop {
            interval.tick().await;
            dispatch_pending_actions(&state_for_dispatcher).await;
        }
    });

    // ── HTTP server ───────────────────────────────────────────────────────
    let app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/v1/ws", get(routes::ws::hub_websocket))
        .route("/v1/pair", post(routes::devices::pair))
        .route("/v1/devices/heartbeat", post(routes::devices::heartbeat))
        .route("/v1/devices/telemetry", post(routes::devices::telemetry))
        .route("/v1/devices/status", post(routes::devices::device_status))
        .route("/v1/devices/sync", post(routes::devices::sync_devices))
        .route("/v1/actions/ack", post(routes::actions::ack))
        .route("/v1/actions/fail", post(routes::actions::fail))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    tracing::info!("IoT Gateway listening on http://0.0.0.0:{}", port);
    axum::serve(listener, app).await?;

    Ok(())
}

// ── MQTT message handler ──────────────────────────────────────────────────────

/// Route incoming MQTT messages to the appropriate SpacetimeDB reducer.
///
/// Topic conventions:
///   `iot/<device_id>/telemetry` — sensor reading JSON
///   `iot/<device_id>/status`    — device status string
async fn handle_mqtt_message(state: &AppState, topic: &str, payload: &[u8]) {
    let parts: Vec<&str> = topic.split('/').collect();

    // Expecting exactly 3 parts: "iot", "<device_id>", "<event>"
    if parts.len() != 3 || parts[0] != "iot" {
        tracing::warn!("Unexpected MQTT topic: {}", topic);
        return;
    }

    let device_id: u64 = match parts[1].parse() {
        Ok(id) => id,
        Err(_) => {
            tracing::warn!("Non-numeric device_id in topic: {}", topic);
            return;
        }
    };

    let event_type = parts[2];
    let org_id = state.config.default_org_id;

    match event_type {
        "telemetry" => {
            let Ok(body) = serde_json::from_slice::<serde_json::Value>(payload) else {
                tracing::warn!("Invalid JSON in telemetry from device {}", device_id);
                return;
            };

            let args = serde_json::json!({
                "organization_id": org_id,
                "device_id": device_id,
                "params": {
                    "sensor_type": body["sensor_type"],
                    "value": body["value"].as_f64().unwrap_or(0.0),
                    "raw_value": body.get("raw_value"),
                    "unit": body["unit"],
                    "quality": body.get("quality").and_then(|q| q.as_str()).unwrap_or("good"),
                }
            });

            if let Err(e) = state.call_reducer("record_telemetry", args).await {
                tracing::error!("record_telemetry failed for device {}: {}", device_id, e);
            }
        }

        "status" => {
            let status = match std::str::from_utf8(payload) {
                Ok(s) => s.trim().to_string(),
                Err(_) => return,
            };

            let args = serde_json::json!({
                "organization_id": org_id,
                "device_id": device_id,
                "status": status,
            });

            if let Err(e) = state.call_reducer("update_device_status", args).await {
                tracing::error!(
                    "update_device_status failed for device {}: {}",
                    device_id,
                    e
                );
            }
        }

        other => {
            tracing::debug!("Unhandled MQTT event type '{}' for device {}", other, device_id);
        }
    }
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

/// Poll SpacetimeDB for pending IoTAction rows and deliver them to their hubs.
///
/// Delivery strategy (WS-first, MQTT fallback):
/// 1. If the action row carries a `hub_id` field AND that hub has an active
///    WebSocket connection, serialize the row as JSON and push it over the
///    hub's mpsc channel.  The hub receives it immediately without waiting for
///    the next poll tick.
/// 2. Otherwise publish the action to `iot/<device_id>/action` via MQTT so
///    that hubs without a persistent WebSocket connection are still served.
///
/// In both cases `mark_action_sent` is called after successful delivery to
/// prevent the same action from being dispatched again.
async fn dispatch_pending_actions(state: &AppState) {
    let rows = match state.query_table("iot_action").await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to query iot_action: {}", e);
            return;
        }
    };

    let pending: Vec<_> = rows
        .iter()
        .filter(|r| r.get("status").and_then(|s| s.as_str()) == Some("Pending"))
        .collect();

    if pending.is_empty() {
        return;
    }

    tracing::info!("Dispatching {} pending IoT actions", pending.len());

    for action in pending {
        let Some(action_id) = action["id"].as_u64() else {
            continue;
        };
        let Some(device_id) = action["device_id"].as_u64() else {
            continue;
        };
        let Some(org_id) = action["organization_id"].as_u64() else {
            continue;
        };

        // Determine whether this action's hub is connected via WebSocket.
        // IoTAction rows are expected to carry a `hub_id` column that
        // identifies which hub manages the device.
        let hub_id_opt = action["hub_id"].as_u64();

        let delivered_via_ws = if let Some(hub_id) = hub_id_opt {
            try_deliver_via_ws(state, hub_id, action_id, action)
        } else {
            false
        };

        if delivered_via_ws {
            // Action pushed to the hub's WebSocket channel — mark as Sent.
            let args = serde_json::json!({
                "organization_id": org_id,
                "action_id": action_id,
            });
            if let Err(e) = state.call_reducer("mark_action_sent", args).await {
                tracing::error!(
                    "mark_action_sent failed for action {} (WS path): {}",
                    action_id,
                    e
                );
            }
        } else {
            // Fallback: publish to MQTT so non-WS hubs are still served.
            deliver_via_mqtt(state, action_id, device_id, org_id, action).await;
        }
    }
}

/// Attempt to deliver `action` to `hub_id` over its WebSocket channel.
///
/// Returns `true` if the hub was connected and the message was enqueued
/// successfully.  Returns `false` if the hub has no active WS connection or
/// the channel is closed (hub disconnected between the registry lookup and
/// the send).
fn try_deliver_via_ws(
    state: &AppState,
    hub_id: u64,
    action_id: u64,
    action: &serde_json::Value,
) -> bool {
    let Some(sender) = state.hub_connections.get(&hub_id) else {
        return false;
    };

    let payload = match serde_json::to_string(action) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(
                "Failed to serialise action {} for WS delivery: {}",
                action_id,
                e
            );
            return false;
        }
    };

    match sender.send(payload) {
        Ok(()) => {
            tracing::debug!(
                "Action {} pushed to hub {} via WebSocket",
                action_id,
                hub_id
            );
            true
        }
        Err(_) => {
            // The receiver was dropped — hub disconnected; fall through to MQTT.
            tracing::warn!(
                "Hub {} WS channel closed — falling back to MQTT for action {}",
                hub_id,
                action_id
            );
            // Remove the stale entry so future iterations skip the WS path.
            state.hub_connections.remove(&hub_id);
            false
        }
    }
}

/// Publish `action` to `iot/<device_id>/action` via MQTT and mark it as Sent.
async fn deliver_via_mqtt(
    state: &AppState,
    action_id: u64,
    device_id: u64,
    org_id: u64,
    action: &serde_json::Value,
) {
    let topic = format!("iot/{}/action", device_id);
    let payload = serde_json::to_vec(action).unwrap_or_default();

    let mqtt = state.mqtt.lock().await;

    match mqtt.publish(&topic, QoS::AtLeastOnce, false, payload).await {
        Ok(_) => {
            // Mark action as Sent in SpacetimeDB
            let args = serde_json::json!({
                "organization_id": org_id,
                "action_id": action_id,
            });
            if let Err(e) = state.call_reducer("mark_action_sent", args).await {
                tracing::error!(
                    "mark_action_sent failed for action {} (MQTT path): {}",
                    action_id,
                    e
                );
            }
        }
        Err(e) => {
            tracing::error!(
                "Failed to publish action {} to {}: {}",
                action_id,
                topic,
                e
            );
        }
    }
}
