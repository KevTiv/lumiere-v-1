//! HTTP process lifecycle: environment, tracing, listener and serving.
mod cors;
mod router;

use crate::{config::Config, state::AppState};
use anyhow::Context;
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn load_dotenv_files() {
    if std::env::var("LUMIERE_E2E").ok().as_deref() == Some("1") {
        return;
    }
    let _ = dotenvy::dotenv();
    let server_local = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env.local");
    let _ = dotenvy::from_path_override(&server_local);
    let _ = dotenvy::from_filename_override(".env.local");
}

pub(crate) async fn serve() -> anyhow::Result<()> {
    load_dotenv_files();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api_server=debug,tower_http=info".parse().unwrap()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;

    let cors = cors::layer(&config);

    // Operators can keep disposable authenticated fixtures on loopback.
    let bind_ip: IpAddr = std::env::var("LUMIERE_API_BIND_IP")
        .unwrap_or_else(|_| "0.0.0.0".into())
        .parse()
        .context("LUMIERE_API_BIND_IP must be an IP address")?;
    let addr = SocketAddr::new(bind_ip, config.port);
    let state = Arc::new(AppState::new(config));
    tracing::info!(
        "api-server on {} → STDB {} / {}",
        addr,
        state.config.stdb_host,
        state.config.stdb_module
    );

    let app = router::app(state, cors);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
