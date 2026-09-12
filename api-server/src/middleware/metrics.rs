//! HTTP request/error counters for Prometheus.

use axum::{
    extract::Request,
    http::{HeaderName, HeaderValue},
    middleware::Next,
    response::Response,
};
use tracing::Instrument;

const CORRELATION_HEADER: HeaderName = HeaderName::from_static("x-correlation-id");
const RELEASE_HEADER: HeaderName = HeaderName::from_static("x-lumiere-release");

fn operation_identity(path: &str) -> &str {
    path.strip_prefix("/v1/operations/")
        .filter(|operation| {
            !operation.is_empty()
                && operation.len() <= 128
                && operation
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
        .unwrap_or("http.request")
}

/// Increment request counter; increment error counter on 5xx responses.
pub async fn track_http_metrics(request: Request, next: Next) -> Response {
    let skip = request.uri().path() == "/metrics";
    let typed_operation = request.uri().path().starts_with("/v1/operations/");
    let compat_reducer = request.uri().path().starts_with("/v1/compat/reducer/");
    let operation_id = operation_identity(request.uri().path()).to_owned();
    let correlation_id = crate::trusted_context::opaque_correlation_id();
    let span = tracing::info_span!(
        "http_request",
        correlation_id = %correlation_id,
        operation_id = %operation_id,
        release_id = concat!("api-server/", env!("CARGO_PKG_VERSION")),
    );
    if !skip {
        crate::metrics::inc_request();
        if typed_operation {
            crate::metrics::inc_typed_operation();
        }
        if compat_reducer {
            crate::metrics::inc_compat_reducer_call();
        }
    }

    let mut response = next.run(request).instrument(span).await;

    if !skip && response.status().is_server_error() {
        crate::metrics::inc_error();
    }
    if compat_reducer && !response.status().is_success() {
        crate::metrics::inc_compat_reducer_call_failure();
    }

    if let Ok(value) = HeaderValue::from_str(&correlation_id) {
        response.headers_mut().insert(CORRELATION_HEADER, value);
    }
    response.headers_mut().insert(
        RELEASE_HEADER,
        HeaderValue::from_static(concat!("api-server/", env!("CARGO_PKG_VERSION"))),
    );

    response
}

#[cfg(test)]
mod tests {
    use super::operation_identity;

    #[test]
    fn operation_identity_accepts_only_bounded_structured_ids() {
        assert_eq!(
            operation_identity("/v1/operations/erp.confirm_sales_order"),
            "erp.confirm_sales_order"
        );
        assert_eq!(operation_identity("/v1/query/contacts"), "http.request");
        assert_eq!(
            operation_identity("/v1/operations/bad/value"),
            "http.request"
        );
        assert_eq!(
            operation_identity(&format!("/v1/operations/{}", "x".repeat(129))),
            "http.request"
        );
    }
}
