use std::sync::Arc;

use dashmap::DashMap;
use rumqttc::AsyncClient;
use tokio::sync::{mpsc, Mutex};

use crate::config::Config;

/// Shared application state passed to all Axum route handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub http: reqwest::Client,
    /// MQTT client — wrapped in Mutex because AsyncClient is not Clone
    pub mqtt: Arc<Mutex<AsyncClient>>,
    /// Active hub WebSocket connections keyed by hub_id.
    ///
    /// When a hub establishes a persistent WebSocket connection via `GET /v1/ws`,
    /// its sender channel is inserted here. The action dispatcher checks this map
    /// first; if the hub is present the action is pushed over WS immediately rather
    /// than waiting for the next MQTT poll cycle.
    pub hub_connections: Arc<DashMap<u64, mpsc::UnboundedSender<String>>>,
}

impl AppState {
    pub fn new(config: Config, mqtt: AsyncClient) -> Self {
        AppState {
            config: Arc::new(config),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("Failed to build HTTP client"),
            mqtt: Arc::new(Mutex::new(mqtt)),
            hub_connections: Arc::new(DashMap::new()),
        }
    }

    /// Call a SpacetimeDB reducer via the REST API.
    ///
    /// SpacetimeDB exposes reducers at:
    ///   POST /database/call/<module>/<reducer>
    /// with the token in the Authorization header.
    pub async fn call_reducer(
        &self,
        reducer: &str,
        args: serde_json::Value,
    ) -> anyhow::Result<()> {
        let url = format!(
            "{}/database/call/{}/{}",
            self.config.stdb_host, self.config.stdb_module, reducer
        );

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.config.stdb_token)
            .json(&args)
            .send()
            .await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Reducer '{}' failed: {}", reducer, body);
        }

        Ok(())
    }

    /// Query a SpacetimeDB table via the REST API.
    pub async fn query_table(
        &self,
        table: &str,
    ) -> anyhow::Result<Vec<serde_json::Value>> {
        let url = format!(
            "{}/database/sql/{}",
            self.config.stdb_host, self.config.stdb_module
        );

        let sql = format!("SELECT * FROM {}", table);

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.config.stdb_token)
            .json(&serde_json::json!({ "query": sql }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Query '{}' failed: {}", table, body);
        }

        let rows: Vec<serde_json::Value> = resp.json().await?;
        Ok(rows)
    }
}
