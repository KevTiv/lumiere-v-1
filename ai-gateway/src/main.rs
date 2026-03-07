mod config;
mod embeddings;
mod error;
mod qdrant_client;
mod routes;
mod state;
mod stdb_client;
mod worker;

use std::sync::Arc;

use axum::{
    Router,
    routing::{delete, get, post},
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use config::Config;
use embeddings::EmbeddingClient;
use qdrant_client::VectorStore;
use state::AppState;
use stdb_client::StdbClient;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file if present (dev convenience)
    let _ = dotenvy::dotenv();

    // Init structured logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "ai_gateway=debug,tower_http=info".parse().unwrap()
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    tracing::info!("Starting Lumiere AI Gateway on port {}", config.port);

    // Build shared state
    let embedder = EmbeddingClient::new(
        config.voyage_api_key.clone(),
        config.embedding_model.clone(),
    );

    let vector_store = VectorStore::new(
        &config.qdrant_url,
        config.qdrant_api_key.as_deref(),
        config.qdrant_collection.clone(),
    )
    .await?;

    // Ensure Qdrant collection exists with the configured dimensions
    vector_store
        .ensure_collection(config.embedding_dim as u64)
        .await?;

    let stdb = StdbClient::new(
        config.stdb_host.clone(),
        config.stdb_module.clone(),
        config.stdb_token.clone(),
    );

    let config = Arc::new(config);
    let embedder = Arc::new(embedder);
    let vector_store = Arc::new(vector_store);
    let stdb = Arc::new(stdb);

    let state = AppState {
        config: config.clone(),
        embedder: embedder.clone(),
        vector_store: vector_store.clone(),
        stdb: stdb.clone(),
        http: Arc::new(reqwest::Client::new()),
    };

    // Spawn background queue worker
    tokio::spawn(worker::run(
        config.clone(),
        embedder.clone(),
        vector_store.clone(),
        stdb.clone(),
    ));

    // Build Axum router
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/v1/embed", post(routes::embed::post_embed))
        .route("/v1/embed", delete(routes::embed::delete_embed))
        .route("/v1/search", post(routes::search::post_search))
        .route("/v1/rag", post(routes::rag::post_rag))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on {}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}
