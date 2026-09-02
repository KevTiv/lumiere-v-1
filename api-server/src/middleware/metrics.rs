//! HTTP request/error counters for Prometheus.

use axum::{extract::Request, middleware::Next, response::Response};

/// Increment request counter; increment error counter on 5xx responses.
pub async fn track_http_metrics(request: Request, next: Next) -> Response {
    let skip = request.uri().path() == "/metrics";
    let typed_operation = request.uri().path().starts_with("/v1/operations/");
    let compat_reducer = request.uri().path().starts_with("/v1/compat/reducer/");
    if !skip {
        crate::metrics::inc_request();
        if typed_operation {
            crate::metrics::inc_typed_operation();
        }
        if compat_reducer {
            crate::metrics::inc_compat_reducer_call();
        }
    }

    let response = next.run(request).await;

    if !skip && response.status().is_server_error() {
        crate::metrics::inc_error();
    }
    if compat_reducer && !response.status().is_success() {
        crate::metrics::inc_compat_reducer_call_failure();
    }

    response
}
