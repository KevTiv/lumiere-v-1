mod ai_agent;
mod config;
mod context_worker;
mod error;
mod harness;
mod kaggle;
mod providers;
mod qdrant_client;
mod rig_agent;
mod routes;
mod state;
mod stdb_embed;
mod worker;

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, post},
    Router,
};
use dashmap::DashMap;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use config::Config;
use providers::build as build_providers;
use qdrant_client::VectorStore;
use rig_agent::RigContext;
use state::AppState;
use stdb_client::StdbClient;

async fn require_gateway_secret(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let Some(expected) = state.config.internal_secret.as_deref() else {
        tracing::warn!(
            "AI gateway internal secret is not configured; rejecting non-health request"
        );
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };

    let provided = request
        .headers()
        .get("x-lumiere-gateway-secret")
        .and_then(|value| value.to_str().ok());

    if provided != Some(expected) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ai_gateway=debug,tower_http=info".parse().unwrap()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    tracing::info!("Starting Lumiere AI Gateway on port {}", config.port);

    let vector_store = VectorStore::new(
        &config.qdrant_url,
        config.qdrant_api_key.as_deref(),
        config.qdrant_collection.clone(),
    )
    .await?;

    let stdb = StdbClient::new(
        config.stdb_host.clone(),
        config.stdb_module.clone(),
        config.stdb_token.clone(),
    );

    let providers = build_providers(&config)?;
    let embed_dim = providers.embedder.dimensions();

    vector_store.ensure_collection(embed_dim).await?;

    let rig = RigContext::new(&config, providers.clone()).await?;
    rig.ensure_collection().await?;

    let config = Arc::new(config);
    let vector_store = Arc::new(vector_store);
    let stdb = Arc::new(stdb);
    let rig = Arc::new(rig);

    let state = AppState {
        config: config.clone(),
        providers: providers.clone(),
        vector_store: vector_store.clone(),
        stdb: stdb.clone(),
        rig: rig.clone(),
        http: Arc::new(reqwest::Client::new()),
        download_jobs: Arc::new(DashMap::new()),
        kaggle_search_cache: Arc::new(DashMap::new()),
        activity_watermarks: Arc::new(DashMap::new()),
    };

    tokio::spawn(worker::run(
        config.clone(),
        providers.embedder.clone(),
        vector_store.clone(),
        stdb.clone(),
    ));

    tokio::spawn(context_worker::run(state.clone()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let v1_routes = Router::new()
        .route("/v1/embed", post(routes::embed::post_embed))
        .route("/v1/embed", delete(routes::embed::delete_embed))
        .route("/v1/search", post(routes::search::post_search))
        .route("/v1/rag", post(routes::rag::post_rag))
        .route("/v1/rag/stream", post(routes::rag::post_rag_stream))
        .route("/v1/actions/draft", post(routes::actions::post_draft))
        .route(
            "/v1/briefing/generate",
            post(routes::briefing::post_generate),
        )
        .route("/v1/forms/suggest", post(routes::forms::post_suggest))
        .route("/v1/forms/validate", post(routes::forms::post_validate))
        .route("/v1/import/analyze", post(routes::import::post_analyze))
        .route("/v1/import/preview", post(routes::import::post_preview))
        .route("/v1/reports/explain", post(routes::reports::post_explain))
        .route(
            "/v1/insights/generate",
            post(routes::insights::post_generate),
        )
        .route("/v1/context/search", post(routes::context::post_search))
        .route("/v1/context/ingest", post(routes::context::post_ingest))
        .route("/v1/context/document", post(routes::context::post_document))
        .route("/v1/kaggle/search", post(routes::kaggle::post_search))
        .route("/v1/kaggle/download", post(routes::kaggle::post_download))
        .route("/v1/kaggle/status/:job_id", get(routes::kaggle::get_status))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_gateway_secret,
        ));

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .merge(v1_routes)
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on {}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}
