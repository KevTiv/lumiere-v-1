//! Lumiere Axum API server — library surface for the `api-server` binary.

mod auth_password;
pub mod config;
mod middleware;
pub mod domain_queries;
pub mod error;
pub mod query_exec;
pub mod realtime;
pub mod reducer_allowlist;
pub mod metrics;
pub mod reports;
pub mod routes;
pub mod session;
pub mod state;
pub mod web_session;

mod http_app;
mod stdb_sdk_bindings;

/// Run the HTTP server (env, tracing, bind, serve).
pub async fn run() -> anyhow::Result<()> {
    http_app::serve().await
}
