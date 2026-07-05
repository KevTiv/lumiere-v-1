//! HTTP request/error counters for Prometheus.

use axum::{extract::Request, middleware::Next, response::Response};

/// Increment request counter; increment error counter on 5xx responses.
pub async fn track_http_metrics(request: Request, next: Next) -> Response {
    let skip = request.uri().path() == "/metrics";
    if !skip {
        crate::metrics::inc_request();
    }

    let response = next.run(request).await;

    if !skip && response.status().is_server_error() {
        crate::metrics::inc_error();
    }

    response
}
