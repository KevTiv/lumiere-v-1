/// IoT Integration module — Odoo IoT Box-style device management.
///
/// # Sub-modules
/// - `registry`     — IoTHub, IoTDevice: register and manage physical hardware
/// - `telemetry`    — IoTTelemetry, IoTThreshold: ingest sensor readings + alerts
/// - `actions`      — IoTAction: command queue for output devices
/// - `alerts`       — IoTAlert: threshold violations and anomaly notifications
/// - `integrations` — Link devices to ERP entities (workcenters, locations, POS)
///
/// # Architecture
///
/// ```
/// Physical Devices
///       │  MQTT / HTTP / WebSocket
///       ▼
/// IoT Gateway (iot-gateway/ Axum service)
///       │  SpacetimeDB reducers
///       ▼
/// SpacetimeDB IoT module (this)
///       │  real-time subscriptions
///       ▼
/// ERP frontend
/// ```
///
/// The gateway service polls `iot_action` for Pending rows and dispatches them
/// to devices. It publishes incoming device events by calling `record_telemetry`
/// and `update_device_status`.
pub mod actions;
pub mod alerts;
pub mod integrations;
pub mod registry;
pub mod telemetry;
