use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    // SpacetimeDB connection (used for calling reducers via REST)
    pub stdb_host: String,
    pub stdb_module: String,
    pub stdb_token: String,
    // MQTT broker
    pub mqtt_host: String,
    pub mqtt_port: u16,
    pub mqtt_client_id: String,
    pub mqtt_username: Option<String>,
    pub mqtt_password: Option<String>,
    /// How often to poll SpacetimeDB for pending IoTActions (seconds)
    pub action_poll_secs: u64,
    /// Default organization_id used when calling reducers from the gateway
    pub default_org_id: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8081".to_string())
                .parse()
                .context("PORT must be a valid number")?,
            stdb_host: std::env::var("STDB_HOST")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            stdb_module: std::env::var("STDB_MODULE")
                .context("STDB_MODULE is required (e.g. lumiere-v1)")?,
            stdb_token: std::env::var("STDB_TOKEN")
                .context("STDB_TOKEN is required")?,
            mqtt_host: std::env::var("MQTT_HOST")
                .unwrap_or_else(|_| "localhost".to_string()),
            mqtt_port: std::env::var("MQTT_PORT")
                .unwrap_or_else(|_| "1883".to_string())
                .parse()
                .context("MQTT_PORT must be a valid number")?,
            mqtt_client_id: std::env::var("MQTT_CLIENT_ID")
                .unwrap_or_else(|_| "lumiere-iot-gateway".to_string()),
            mqtt_username: std::env::var("MQTT_USERNAME").ok(),
            mqtt_password: std::env::var("MQTT_PASSWORD").ok(),
            action_poll_secs: std::env::var("ACTION_POLL_SECS")
                .unwrap_or_else(|_| "5".to_string())
                .parse()
                .context("ACTION_POLL_SECS must be a valid number")?,
            default_org_id: std::env::var("DEFAULT_ORG_ID")
                .unwrap_or_else(|_| "1".to_string())
                .parse()
                .context("DEFAULT_ORG_ID must be a valid number")?,
        })
    }
}
