mod ai_agent;
mod config;
mod context_worker;
mod error;
mod harness;
mod kaggle;
mod orchestrator;
mod providers;
mod qdrant_client;
mod rate_limit;
mod retrieval_policy;
mod rig_agent;
mod routes;
mod skills;
mod state;
mod stdb_embed;
mod tools;
mod wire_decode;
mod worker;

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
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

fn accept_optional_semantic_init(dependency: &str, result: anyhow::Result<()>) -> bool {
    match result {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!(
                dependency,
                error = %error,
                "Semantic index unavailable at startup; continuing in degraded mode"
            );
            false
        }
    }
}

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

    let http = reqwest::Client::new();
    let providers = build_providers(&config, http.clone())?;
    let embed_dim = providers.embedder.dimensions();

    accept_optional_semantic_init(
        "primary semantic collection",
        vector_store.ensure_collection(embed_dim).await,
    );

    let rig = RigContext::new(&config, providers.clone()).await?;
    accept_optional_semantic_init(
        "activity reference collection",
        rig.ensure_collection().await,
    );

    let config = Arc::new(config);
    let certification_stdb = config.ai_certification_stdb_token.as_ref().map(|token| {
        Arc::new(StdbClient::new(
            config.stdb_host.clone(),
            config.stdb_module.clone(),
            token.clone(),
        ))
    });
    let vector_store = Arc::new(vector_store);
    let stdb = Arc::new(stdb);
    let rig = Arc::new(rig);

    let state = AppState {
        config: config.clone(),
        providers: providers.clone(),
        vector_store: vector_store.clone(),
        stdb: stdb.clone(),
        rig: rig.clone(),
        http: Arc::new(http),
        download_jobs: Arc::new(DashMap::new()),
        kaggle_search_cache: Arc::new(DashMap::new()),
        activity_watermarks: Arc::new(DashMap::new()),
        agent_rate_limiter: Arc::new(crate::rate_limit::AgentRateLimiter::new()),
    };

    tokio::spawn(worker::run(
        config.clone(),
        providers.embedder.clone(),
        vector_store.clone(),
        stdb.clone(),
    ));

    if let Some(certification_stdb) = certification_stdb {
        tokio::spawn(harness::certification::run(
            config.clone(),
            certification_stdb,
            Arc::new(harness::certification::CandidateAdapterRegistry::production()),
        ));
    } else {
        tracing::info!(
            "AI certification worker disabled; AI_CERTIFICATION_STDB_TOKEN is not configured"
        );
    }

    tokio::spawn(context_worker::run(state.clone()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let v1_routes = Router::new()
        .route("/v1/search", post(routes::search::post_search))
        .route("/v1/rag", post(routes::rag::post_rag))
        .route("/v1/rag/stream", post(routes::rag::post_rag_stream))
        .route("/v1/actions/draft", post(routes::actions::post_draft))
        .route(
            "/v1/actions/bridge",
            post(routes::action_draft_bridge::post_bridge),
        )
        .route("/v1/skills", get(routes::skills::get_skills))
        .route("/v1/skills/run", post(routes::skills::post_run))
        .route("/v1/skills/sync", post(routes::skills::post_sync))
        .route("/v1/forms/suggest", post(routes::forms::post_suggest))
        .route("/v1/forms/validate", post(routes::forms::post_validate))
        .route("/v1/import/analyze", post(routes::import::post_analyze))
        .route("/v1/import/preview", post(routes::import::post_preview))
        .route("/v1/context/search", post(routes::context::post_search))
        .route("/v1/context/ingest", post(routes::context::post_ingest))
        .route("/v1/context/document", post(routes::context::post_document))
        .route("/v1/kaggle/search", post(routes::kaggle::post_search))
        .route("/v1/kaggle/download", post(routes::kaggle::post_download))
        .route("/v1/kaggle/status/:job_id", get(routes::kaggle::get_status))
        .route("/v1/policy/evaluate", post(routes::policy::post_evaluate))
        .route(
            "/v1/skills/report/compose",
            post(routes::report::post_compose),
        )
        .route(
            "/v1/skills/inventory/low-stock",
            post(routes::inventory::post_scan),
        )
        .route(
            "/v1/skills/distributor/credit-hold-summary",
            post(routes::distributor::post_credit_hold_summary),
        )
        .route(
            "/v1/skills/distributor/delivery-run-summary",
            post(routes::distributor::post_delivery_run_summary),
        )
        .route(
            "/v1/skills/import-mapping",
            post(routes::harness_skills::post_import_mapping),
        )
        .route(
            "/v1/skills/insights-scan",
            post(routes::harness_skills::post_insights_scan),
        )
        .route(
            "/v1/skills/daily-briefing",
            post(routes::harness_skills::post_daily_briefing),
        )
        .route(
            "/v1/skills/report-analysis",
            post(routes::harness_skills::post_report_analysis),
        )
        .route(
            "/v1/skills/process-research",
            post(routes::harness_skills::post_process_research),
        )
        .route(
            "/v1/skills/price-search",
            post(routes::harness_skills::post_price_search),
        )
        .route(
            "/v1/skills/supplier-discovery",
            post(routes::harness_skills::post_supplier_discovery),
        )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_index_startup_failure_is_non_fatal() {
        assert!(accept_optional_semantic_init("qdrant", Ok(())));
        assert!(!accept_optional_semantic_init(
            "qdrant",
            Err(anyhow::anyhow!("unavailable")),
        ));
    }
}
