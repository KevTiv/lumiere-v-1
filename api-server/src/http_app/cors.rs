//! Credential-compatible CORS policy for the HTTP server.

use crate::config::Config;
use axum::http::{
    header::{HeaderName, ACCEPT, ACCEPT_LANGUAGE, AUTHORIZATION, CONTENT_TYPE, COOKIE},
    HeaderValue, Method,
};
use tower_http::cors::CorsLayer;

pub(super) fn layer(config: &Config) -> CorsLayer {
    const DEFAULT_DEV_ORIGINS: &[&str] = &[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3100",
        "http://127.0.0.1:3100",
    ];
    let origins: Vec<HeaderValue> = if config.cors_origins.is_empty() {
        DEFAULT_DEV_ORIGINS
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect()
    } else {
        config
            .cors_origins
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect()
    };
    let allow_origin = if origins.is_empty() {
        tracing::warn!("no valid CORS origins; falling back to http://localhost:3000 (set CORS_ORIGINS otherwise)");
        tower_http::cors::AllowOrigin::exact(
            "http://localhost:3000"
                .parse()
                .expect("static localhost origin"),
        )
    } else {
        tower_http::cors::AllowOrigin::list(origins)
    };
    const CORS_ALLOW_METHODS: [Method; 7] = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
        Method::HEAD,
    ];
    const CORS_ALLOW_HEADERS: [HeaderName; 11] = [
        AUTHORIZATION,
        CONTENT_TYPE,
        ACCEPT,
        ACCEPT_LANGUAGE,
        HeaderName::from_static("x-stdb-identity"),
        COOKIE,
        HeaderName::from_static("connection"),
        HeaderName::from_static("upgrade"),
        HeaderName::from_static("sec-websocket-key"),
        HeaderName::from_static("sec-websocket-version"),
        HeaderName::from_static("sec-websocket-protocol"),
    ];
    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_credentials(true)
        .allow_methods(CORS_ALLOW_METHODS)
        .allow_headers(CORS_ALLOW_HEADERS)
}
