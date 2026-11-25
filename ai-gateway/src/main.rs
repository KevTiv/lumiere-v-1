mod ai_agent;
mod ai_spend;
mod config;
mod context_worker;
mod error;
mod harness;
mod kaggle;
mod non_llm_spend;
mod observed_chat;
mod orchestrator;
mod providers;
mod qdrant_client;
mod rate_limit;
mod reindex;
mod retrieval_policy;
mod rig_agent;
mod routes;
mod sandbox;
mod skills;
mod state;
mod stdb_embed;
mod tools;
#[cfg(test)]
mod wire_contract_tests;
mod wire_decode;
mod worker;

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, MatchedPath, State},
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
use tracing::Instrument;
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

async fn trace_ai_request(request: Request<Body>, next: Next) -> Response {
    const REQUEST_ID: &str = "x-lumiere-ai-request-id";
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str)
        .unwrap_or_default();
    if !matches!(
        route,
        "/v1/rag" | "/v1/rag/stream" | "/v1/context/ingest" | "/v1/evidence/rag-outcomes"
    ) && !route.starts_with("/v1/skills/")
        && !route.starts_with("/v1/harness/")
        && !route.starts_with("/v1/internal/harness/")
        && !route.starts_with("/v1/actions/")
    {
        return next.run(request).await;
    }
    let request_id = request
        .headers()
        .get(REQUEST_ID)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        .unwrap_or_else(uuid::Uuid::new_v4);
    let span = tracing::info_span!("ai_request", %request_id, route);
    async move {
        let started = std::time::Instant::now();
        tracing::info!(stage = "received");
        let mut response = next.run(request).await;
        if let Ok(header) = axum::http::HeaderValue::from_str(&request_id.to_string()) {
            response.headers_mut().insert(REQUEST_ID, header);
        }
        let status = response.status().as_u16();
        let duration_ms = started.elapsed().as_millis() as u64;
        if status >= 400 {
            tracing::warn!(stage = "rejected", status, duration_ms);
        } else {
            tracing::info!(stage = "response_ready", status, duration_ms);
        }
        response
    }
    .instrument(span)
    .await
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("certification-bundles") {
        println!(
            "{}",
            serde_json::json!({
                "schemaVersion": 1,
                "low_stock": {"version": harness::low_stock::LOW_STOCK_RELEASE_VERSION, "sourceHash": harness::certification::low_stock_certification_bundle_hash()},
                "report_composer": {"version": harness::report_composer::REPORT_COMPOSER_RELEASE_VERSION, "sourceHash": harness::certification::report_composer_certification_bundle_hash()},
                "report_analysis": {"version": harness::certification::REPORT_ANALYSIS_CERTIFICATION_VERSION, "sourceHash": harness::certification::report_analysis_certification_bundle_hash()},
                "rag_generation": {"version": orchestrator::generation_surface_certification::VERSION, "sourceHash": orchestrator::generation_surface_certification::bundle_hash("rag_generation").map_err(anyhow::Error::msg)?},
                "form_suggestion": {"version": orchestrator::generation_surface_certification::VERSION, "sourceHash": orchestrator::generation_surface_certification::bundle_hash("form_suggestion").map_err(anyhow::Error::msg)?},
                "action_draft_generation": {"version": orchestrator::generation_surface_certification::VERSION, "sourceHash": orchestrator::generation_surface_certification::bundle_hash("action_draft_generation").map_err(anyhow::Error::msg)?}
            })
        );
        return Ok(());
    }
    let _ = dotenvy::dotenv();

    if std::env::args().nth(1).as_deref() == Some("reindex-company") {
        return reindex::run_from_env(std::env::args().skip(2)).await;
    }

    #[cfg(feature = "phase4-acceptance")]
    if std::env::args().nth(1).as_deref() == Some("phase4-restart-probe") {
        return orchestrator::phase4_restart_probe::run_from_env().await;
    }

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gateway=info,tower_http=info".parse().unwrap()),
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
    let vector_store = if config.embedding_enabled() {
        vector_store.with_embedding_space(
            config.embedding_model_name(),
            providers.embedder.dimensions(),
        )?
    } else {
        vector_store
    };
    let rig = RigContext::new(&config, providers.clone()).await?;
    let embedding_index_ready = if config.embedding_enabled() {
        let ready = accept_optional_semantic_init(
            "primary semantic collection",
            vector_store
                .ensure_collection(providers.embedder.dimensions())
                .await,
        );
        accept_optional_semantic_init(
            "activity reference collection",
            rig.ensure_collection().await,
        );
        ready
    } else {
        false
    };

    let config = Arc::new(config);
    let certification_stdb = config.ai_certification_stdb_token.as_ref().map(|token| {
        Arc::new(StdbClient::new(
            config.stdb_host.clone(),
            config.stdb_module.clone(),
            token.clone(),
        ))
    });
    let spend_read_stdb = config.ai_spend_read_stdb_token.as_ref().map(|token| {
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
        spend_read_stdb,
        rig: rig.clone(),
        http: Arc::new(http),
        download_jobs: Arc::new(DashMap::new()),
        kaggle_search_cache: Arc::new(DashMap::new()),
        activity_watermarks: Arc::new(DashMap::new()),
        agent_rate_limiter: Arc::new(crate::rate_limit::AgentRateLimiter::new()),
    };

    if embedding_index_ready {
        tokio::spawn(worker::run(
            config.clone(),
            providers.embedder.clone(),
            vector_store.clone(),
            stdb.clone(),
        ));
    } else {
        tracing::info!("Embedding queue worker disabled or awaiting a compatible index");
    }

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
        .route(
            "/v1/skills/finance/:skill",
            post(routes::harness_skills::post_finance_review),
        )
        .route(
            "/v1/harness/descriptor",
            get(routes::harness_descriptor::get_descriptor),
        )
        .route(
            "/v1/alpha/analytics",
            post(routes::alpha_analytics::post_analytics),
        )
        .route("/v1/search", post(routes::search::post_search))
        .route("/v1/rag", post(observed_chat::post_json))
        .route("/v1/rag/stream", post(observed_chat::post_stream))
        .route("/v1/actions/draft", post(routes::actions::post_draft))
        .route(
            "/v1/actions/bridge",
            post(routes::action_draft_bridge::post_bridge),
        )
        .route(
            "/v1/harness/platform-profile",
            post(routes::platform_profile::post_platform_profile),
        )
        .route("/v1/skills", get(routes::skills::get_skills))
        .route("/v1/skills/run", post(routes::skills::post_run))
        .route("/v1/skills/sync", post(routes::skills::post_sync))
        .route(
            "/v1/skills/provision-surfaces",
            post(routes::skills::post_provision_surfaces),
        )
        .route("/v1/evidence/inspect", post(routes::evidence::post_inspect))
        .route("/v1/evidence/run", post(routes::evidence::post_run_inspect))
        .route(
            "/v1/evidence/runs/history",
            post(routes::evidence::post_run_history),
        )
        .route(
            "/v1/evidence/run/export",
            post(routes::evidence::post_run_export),
        )
        .route(
            "/v1/evidence/review-queue",
            post(routes::evidence::post_review_queue),
        )
        .route(
            "/v1/evidence/rag-outcomes",
            post(routes::rag_outcome::post_rag_outcomes),
        )
        .route(
            "/v1/knowledge/retrieve",
            post(routes::evidence::post_knowledge_retrieve),
        )
        .route("/v1/forms/suggest", post(routes::forms::post_suggest))
        .route("/v1/forms/validate", post(routes::forms::post_validate))
        .route("/v1/import/analyze", post(routes::import::post_analyze))
        .route("/v1/import/preview", post(routes::import::post_preview))
        .route("/v1/context/search", post(routes::context::post_search))
        .route("/v1/context/ingest", post(routes::context::post_ingest))
        .route(
            "/v1/context/index-jobs/drain",
            post(context_worker::post_drain),
        )
        .route("/v1/context/coverage", post(routes::context::post_coverage))
        .route(
            "/v1/documents/ocr",
            post(routes::ocr::post_ocr).layer(DefaultBodyLimit::max(14 * 1024 * 1024)),
        )
        .route(
            "/v1/internal/documents/evidence-readback",
            post(routes::document_evidence::post_readback),
        )
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
            "/v1/harness/governed/bootstrap",
            post(routes::harness_skills::post_governed_bootstrap),
        )
        .route(
            "/v1/internal/harness/report-readiness",
            post(routes::harness_skills::post_report_readiness),
        )
        .route(
            "/v1/internal/harness/skill-bindings",
            get(routes::skill_bindings::get_bindings),
        )
        .route(
            "/v1/harness/governed/readiness",
            post(routes::harness_skills::post_governed_readiness),
        )
        .route(
            "/v1/internal/harness/runs/lifecycle",
            post(routes::run_lifecycle::post_run_lifecycle),
        )
        .route(
            "/v1/internal/local-runner/devices",
            get(routes::local_runner::get_devices),
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
        .route_layer(middleware::from_fn(trace_ai_request))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_gateway_secret,
        ));

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/health/ready", get(routes::health::health_ready))
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

    #[tokio::test]
    async fn descriptor_route_requires_the_gateway_secret() {
        let state = routes::harness_descriptor::test_support::state(
            routes::harness_descriptor::test_support::config(),
        )
        .await;
        let app = Router::new()
            .route(
                "/v1/harness/descriptor",
                get(routes::harness_descriptor::get_descriptor),
            )
            .route_layer(middleware::from_fn_with_state(
                state.clone(),
                require_gateway_secret,
            ))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/v1/harness/descriptor",
            listener.local_addr().unwrap()
        );
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let client = reqwest::Client::new();
        let missing = client.get(&url).send().await.unwrap();
        assert_eq!(missing.status(), reqwest::StatusCode::UNAUTHORIZED);
        let wrong = client
            .get(&url)
            .header("x-lumiere-gateway-secret", "wrong")
            .send()
            .await
            .unwrap();
        assert_eq!(wrong.status(), reqwest::StatusCode::UNAUTHORIZED);
        // Correct secret but no acting-user context: still denied by the route.
        let no_actor = client
            .get(&url)
            .header("x-lumiere-gateway-secret", "gateway-secret")
            .send()
            .await
            .unwrap();
        assert_eq!(no_actor.status(), reqwest::StatusCode::FORBIDDEN);
    }

    #[test]
    fn semantic_index_startup_failure_is_non_fatal() {
        assert!(accept_optional_semantic_init("qdrant", Ok(())));
        assert!(!accept_optional_semantic_init(
            "qdrant",
            Err(anyhow::anyhow!("unavailable")),
        ));
    }
}
