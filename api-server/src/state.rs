use std::sync::Arc;

use crate::config::Config;
use stdb_client::StdbClient;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub stdb: StdbClient,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let stdb = StdbClient::new(
            config.stdb_host.clone(),
            config.stdb_module.clone(),
            config
                .stdb_server_token
                .clone()
                .unwrap_or_else(|| "local-dev-token".into()),
        );
        Self {
            config: Arc::new(config),
            stdb,
            http: reqwest::Client::new(),
        }
    }

    pub fn client_with_token(&self, token: &str) -> StdbClient {
        self.stdb.with_token(token)
    }
}
