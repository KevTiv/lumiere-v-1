//! Route composition and middleware order; no listener or environment side effects.
use crate::routes::{health, operations, queries};
use crate::{middleware::metrics::track_http_metrics, realtime, routes, state::AppState};
use axum::{
    middleware::from_fn,
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tower_cookies::CookieManagerLayer;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

pub(super) fn app(state: Arc<AppState>, cors: CorsLayer) -> Router {
    let v1 = Router::new()
        .route("/query/:resource", get(queries::get_query))
        .route(
            "/authoritative/:resource/:id",
            get(queries::get_authoritative_resource),
        )
        .route("/operations/:operation", post(operations::post_operation))
        .route(
            "/compat/reducer/:reducer",
            post(operations::post_compat_reducer),
        )
        .route("/realtime/ws", get(realtime::realtime_ws_upgrade))
        .route("/realtime/info", get(realtime::realtime_info))
        .merge(routes::domain_router());

    Router::new()
        .route("/health", get(health::health))
        .route("/health/ready", get(health::health_ready))
        .route("/metrics", get(health::metrics_handler))
        .nest("/v1", v1)
        .layer(CookieManagerLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(from_fn(track_http_metrics))
        .with_state(state)
}
