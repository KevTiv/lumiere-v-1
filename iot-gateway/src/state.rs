use std::sync::Arc;

use dashmap::DashMap;
use rumqttc::AsyncClient;
use tokio::sync::{mpsc, Mutex};

use crate::config::Config;
use stdb_client::StdbClient;

/// Shared application state passed to all Axum route handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub stdb: StdbClient,
    /// MQTT client — wrapped in Mutex because AsyncClient is not Clone
    pub mqtt: Arc<Mutex<AsyncClient>>,
    /// Active hub WebSocket connections keyed by hub_id.
    pub hub_connections: Arc<DashMap<u64, mpsc::UnboundedSender<String>>>,
}

impl AppState {
    pub fn new(config: Config, mqtt: AsyncClient) -> Self {
        let host = config.stdb_host.trim_end_matches('/').to_string();
        let stdb = StdbClient::new(host, config.stdb_module.clone(), config.stdb_token.clone());
        AppState {
            config: Arc::new(config),
            stdb,
            mqtt: Arc::new(Mutex::new(mqtt)),
            hub_connections: Arc::new(DashMap::new()),
        }
    }

    /// Call a SpacetimeDB reducer via HTTP (`/v1/database/.../call/...`).
    pub async fn call_reducer(
        &self,
        call: impl stdb_client::IntoReducerCall,
    ) -> anyhow::Result<()> {
        self.stdb
            .call_reducer(call)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
    }

    pub async fn query_table(&self, table: &str) -> anyhow::Result<Vec<serde_json::Value>> {
        self.stdb
            .query_table(table)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
    }
}
