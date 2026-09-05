//! Lightweight request counters for Prometheus scraping.

use std::sync::atomic::{AtomicU64, Ordering};

static REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static REQUEST_ERRORS_TOTAL: AtomicU64 = AtomicU64::new(0);
static TYPED_OPERATIONS_TOTAL: AtomicU64 = AtomicU64::new(0);
static COMPAT_REDUCER_CALLS_TOTAL: AtomicU64 = AtomicU64::new(0);
static COMPAT_REDUCER_CALL_FAILURES_TOTAL: AtomicU64 = AtomicU64::new(0);

pub fn inc_request() {
    REQUESTS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_error() {
    REQUEST_ERRORS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_typed_operation() {
    TYPED_OPERATIONS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_compat_reducer_call() {
    COMPAT_REDUCER_CALLS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_compat_reducer_call_failure() {
    COMPAT_REDUCER_CALL_FAILURES_TOTAL.fetch_add(1, Ordering::Relaxed);
}

// ── Audit cold-tier read path ────────────────────────────────────────────────

static AUDIT_COLD_READ_FAILURES_TOTAL: AtomicU64 = AtomicU64::new(0);

pub fn inc_audit_cold_read_failure() {
    AUDIT_COLD_READ_FAILURES_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn render_prometheus() -> String {
    format!(
        "# HELP lumiere_http_requests_total Total HTTP requests handled\n\
         # TYPE lumiere_http_requests_total counter\n\
         lumiere_http_requests_total {}\n\
         # HELP lumiere_http_errors_total Total HTTP 5xx responses\n\
         # TYPE lumiere_http_errors_total counter\n\
         lumiere_http_errors_total {}\n\
         # HELP lumiere_typed_operations_total Typed operation endpoint requests\n\
         # TYPE lumiere_typed_operations_total counter\n\
         lumiere_typed_operations_total {}\n\
         # HELP lumiere_compat_reducer_calls_total Legacy positional reducer compatibility requests\n\
         # TYPE lumiere_compat_reducer_calls_total counter\n\
         lumiere_compat_reducer_calls_total {}\n\
         # HELP lumiere_compat_reducer_call_failures_total Failed legacy positional reducer compatibility requests\n\
         # TYPE lumiere_compat_reducer_call_failures_total counter\n\
         lumiere_compat_reducer_call_failures_total {}\n\
         # HELP audit_cold_read_failures_total Cold (PG) audit-log read failures; reads fall back to the hot tail only\n\
         # TYPE audit_cold_read_failures_total counter\n\
         audit_cold_read_failures_total {}\n",
        REQUESTS_TOTAL.load(Ordering::Relaxed),
        REQUEST_ERRORS_TOTAL.load(Ordering::Relaxed),
        TYPED_OPERATIONS_TOTAL.load(Ordering::Relaxed),
        COMPAT_REDUCER_CALLS_TOTAL.load(Ordering::Relaxed),
        COMPAT_REDUCER_CALL_FAILURES_TOTAL.load(Ordering::Relaxed),
        AUDIT_COLD_READ_FAILURES_TOTAL.load(Ordering::Relaxed),
    )
}
