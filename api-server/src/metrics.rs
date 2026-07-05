//! Lightweight request counters for Prometheus scraping.

use std::sync::atomic::{AtomicU64, Ordering};

static REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static REQUEST_ERRORS_TOTAL: AtomicU64 = AtomicU64::new(0);

pub fn inc_request() {
    REQUESTS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_error() {
    REQUEST_ERRORS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn render_prometheus() -> String {
    format!(
        "# HELP lumiere_http_requests_total Total HTTP requests handled\n\
         # TYPE lumiere_http_requests_total counter\n\
         lumiere_http_requests_total {}\n\
         # HELP lumiere_http_errors_total Total HTTP 5xx responses\n\
         # TYPE lumiere_http_errors_total counter\n\
         lumiere_http_errors_total {}\n",
        REQUESTS_TOTAL.load(Ordering::Relaxed),
        REQUEST_ERRORS_TOTAL.load(Ordering::Relaxed),
    )
}
