use std::sync::Arc;

use crate::config::Config;
use crate::organization_placement::ConfiguredPlacementResolver;
use stdb_client::StdbClient;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub stdb: StdbClient,
    pub http: reqwest::Client,
    pub organization_placements: ConfiguredPlacementResolver,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let organization_placements = config.organization_placement.clone();
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
            organization_placements,
        }
    }

    pub fn client_with_token(&self, token: &str) -> StdbClient {
        self.stdb.with_token(token)
    }
}
