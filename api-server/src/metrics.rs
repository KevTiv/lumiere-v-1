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

// ── Audit cold-tier (docs/plans/audit-log-cold-by-default.md §8) ───────────

static AUDIT_COLD_FORWARDED_TOTAL: AtomicU64 = AtomicU64::new(0);
static AUDIT_COLD_FORWARD_FAILURES_TOTAL: AtomicU64 = AtomicU64::new(0);
static AUDIT_COLD_FINALIZE_FAILURES_TOTAL: AtomicU64 = AtomicU64::new(0);
static AUDIT_COLD_READ_FAILURES_TOTAL: AtomicU64 = AtomicU64::new(0);
/// Rows still hot per the last bounded backlog probe (see `audit_drainer::backlog_snapshot`
/// — capped at the probe limit, so this reads as "at least N", not an exact count).
static AUDIT_COLD_BACKLOG_ROWS: AtomicU64 = AtomicU64::new(0);
static AUDIT_COLD_OLDEST_ROW_SECONDS: AtomicU64 = AtomicU64::new(0);
/// Stored as microseconds (integer) so `AtomicU64` can hold sub-second precision;
/// rendered as fractional seconds in `render_prometheus`.
static AUDIT_COLD_BATCH_DURATION_MICROS: AtomicU64 = AtomicU64::new(0);

pub fn inc_audit_cold_forwarded() {
    AUDIT_COLD_FORWARDED_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_audit_cold_forward_failure() {
    AUDIT_COLD_FORWARD_FAILURES_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_audit_cold_finalize_failure() {
    AUDIT_COLD_FINALIZE_FAILURES_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn inc_audit_cold_read_failure() {
    AUDIT_COLD_READ_FAILURES_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn set_audit_cold_backlog_rows(rows: u64) {
    AUDIT_COLD_BACKLOG_ROWS.store(rows, Ordering::Relaxed);
}

pub fn set_audit_cold_oldest_row_seconds(seconds: u64) {
    AUDIT_COLD_OLDEST_ROW_SECONDS.store(seconds, Ordering::Relaxed);
}

pub fn set_audit_cold_batch_duration_seconds(seconds: f64) {
    let micros = (seconds.max(0.0) * 1_000_000.0) as u64;
    AUDIT_COLD_BATCH_DURATION_MICROS.store(micros, Ordering::Relaxed);
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
         # HELP audit_cold_forwarded_total Audit rows successfully UPSERTed into cold_audit_log\n\
         # TYPE audit_cold_forwarded_total counter\n\
         audit_cold_forwarded_total {}\n\
         # HELP audit_cold_forward_failures_total Audit row UPSERT failures\n\
         # TYPE audit_cold_forward_failures_total counter\n\
         audit_cold_forward_failures_total {}\n\
         # HELP audit_cold_finalize_failures_total finalize_audit_log_archive call failures\n\
         # TYPE audit_cold_finalize_failures_total counter\n\
         audit_cold_finalize_failures_total {}\n\
         # HELP audit_cold_read_failures_total Cold (PG) audit-log read failures; reads fall back to the hot tail only\n\
         # TYPE audit_cold_read_failures_total counter\n\
         audit_cold_read_failures_total {}\n\
         # HELP audit_cold_backlog_rows Undrained audit_log rows at last probe (capped at the probe limit)\n\
         # TYPE audit_cold_backlog_rows gauge\n\
         audit_cold_backlog_rows {}\n\
         # HELP audit_cold_oldest_row_seconds Age in seconds of the oldest undrained audit_log row at last probe\n\
         # TYPE audit_cold_oldest_row_seconds gauge\n\
         audit_cold_oldest_row_seconds {}\n\
         # HELP audit_cold_batch_duration_seconds Wall time of the last drain batch\n\
         # TYPE audit_cold_batch_duration_seconds gauge\n\
         audit_cold_batch_duration_seconds {:.6}\n",
        REQUESTS_TOTAL.load(Ordering::Relaxed),
        REQUEST_ERRORS_TOTAL.load(Ordering::Relaxed),
        TYPED_OPERATIONS_TOTAL.load(Ordering::Relaxed),
        COMPAT_REDUCER_CALLS_TOTAL.load(Ordering::Relaxed),
        COMPAT_REDUCER_CALL_FAILURES_TOTAL.load(Ordering::Relaxed),
        AUDIT_COLD_FORWARDED_TOTAL.load(Ordering::Relaxed),
        AUDIT_COLD_FORWARD_FAILURES_TOTAL.load(Ordering::Relaxed),
        AUDIT_COLD_FINALIZE_FAILURES_TOTAL.load(Ordering::Relaxed),
        AUDIT_COLD_READ_FAILURES_TOTAL.load(Ordering::Relaxed),
        AUDIT_COLD_BACKLOG_ROWS.load(Ordering::Relaxed),
        AUDIT_COLD_OLDEST_ROW_SECONDS.load(Ordering::Relaxed),
        AUDIT_COLD_BATCH_DURATION_MICROS.load(Ordering::Relaxed) as f64 / 1_000_000.0,
    )
}
