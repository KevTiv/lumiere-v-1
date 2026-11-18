//! Rollout guard for reviewed Sales and Warehouse backfill writes.
//!
//! A release changes the PostgreSQL schema before the new API server is live.
//! Two independent switches keep a writer from running against a schema it was
//! not built for, and both answer with one clear 503 instead of a per-request
//! database failure:
//!
//! * `LUMIERE_IMPORTS_PAUSED` is an operator switch set per deployment for the
//!   duration of a cutover.
//! * The writer compares the migration catalog it was built with to the
//!   version PostgreSQL reports as applied and refuses to write on a mismatch.

use std::{
    future::Future,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    http::{header::RETRY_AFTER, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::cold_tier::{migrate, pg_pool};

/// Environment flag that pauses backfill writes for this deployment.
pub(crate) const PAUSE_ENV: &str = "LUMIERE_IMPORTS_PAUSED";
/// Machine code returned while the operator pause is on.
pub(crate) const PAUSED_CODE: &str = "imports_paused";
/// Machine code returned while this binary and the database disagree.
pub(crate) const SCHEMA_MISMATCH_CODE: &str = "import_writer_schema_mismatch";
/// User-facing wording shared with the chat import cards.
pub(crate) const PAUSED_MESSAGE: &str = "Imports are paused for an update";

/// A schema verdict is reused briefly so a request does not query PostgreSQL,
/// yet a database migrated under a running server is noticed promptly.
const SCHEMA_CACHE_TTL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    Paused,
    SchemaMismatch,
}

impl Refusal {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Paused => PAUSED_CODE,
            Self::SchemaMismatch => SCHEMA_MISMATCH_CODE,
        }
    }
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        let mut response = (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": PAUSED_MESSAGE, "code": self.code()})),
        )
            .into_response();
        response
            .headers_mut()
            .insert(RETRY_AFTER, HeaderValue::from_static("30"));
        response
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SchemaState {
    Compatible,
    /// The applied version differs, or could not be read. Unverifiable is
    /// treated like a mismatch so the writer fails closed.
    Mismatch,
}

/// Parse the pause flag. Only an explicit false value or an unset flag leaves
/// writes open; any other value pauses, so a typo cannot silently resume them.
pub(crate) fn paused_from(value: Option<&str>) -> bool {
    match value.map(|value| value.trim().to_ascii_lowercase()) {
        None => false,
        Some(value) => !matches!(value.as_str(), "" | "0" | "false" | "no" | "off"),
    }
}

pub(crate) fn decide(paused: bool, schema: SchemaState) -> Option<Refusal> {
    if paused {
        Some(Refusal::Paused)
    } else if schema == SchemaState::Mismatch {
        Some(Refusal::SchemaMismatch)
    } else {
        None
    }
}

pub(crate) fn compare_versions(expected: i64, applied: i64) -> SchemaState {
    if expected == applied {
        SchemaState::Compatible
    } else {
        SchemaState::Mismatch
    }
}

#[derive(Default)]
pub(crate) struct SchemaCheck {
    cached: Mutex<Option<(Instant, SchemaState)>>,
}

impl SchemaCheck {
    pub(crate) const fn new() -> Self {
        Self {
            cached: Mutex::new(None),
        }
    }

    /// Return the cached verdict or compute a fresh one with `read`, which
    /// yields the version PostgreSQL reports as applied.
    pub(crate) async fn state<F, Fut>(&self, expected: i64, now: Instant, read: F) -> SchemaState
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = anyhow::Result<i64>>,
    {
        if let Some((at, state)) = *self.cached.lock().unwrap_or_else(|e| e.into_inner()) {
            if now.saturating_duration_since(at) < SCHEMA_CACHE_TTL {
                return state;
            }
        }
        let state = match read().await {
            Ok(applied) => {
                let state = compare_versions(expected, applied);
                if state == SchemaState::Mismatch {
                    tracing::error!(
                        expected,
                        applied,
                        "import writer catalog does not match the database; backfill writes are refused"
                    );
                }
                state
            }
            Err(error) => {
                tracing::error!(%error, "could not verify the migration version; backfill writes are refused");
                SchemaState::Mismatch
            }
        };
        *self.cached.lock().unwrap_or_else(|e| e.into_inner()) = Some((now, state));
        state
    }
}

static SCHEMA_CHECK: SchemaCheck = SchemaCheck::new();

async fn applied_version() -> anyhow::Result<i64> {
    let client = pg_pool::required_pool()?.get().await?;
    let row = client
        .query_one(
            &format!(
                "select coalesce(max(version), 0)::bigint from {}",
                migrate::MIGRATION_TABLE
            ),
            &[],
        )
        .await?;
    Ok(row.get(0))
}

fn expected_version() -> i64 {
    migrate::MIGRATIONS
        .last()
        .map_or(0, |migration| migration.version)
}

/// The verdict for the next backfill write, or `None` when writes may proceed.
pub(crate) async fn refusal() -> Option<Refusal> {
    let paused = paused_from(std::env::var(PAUSE_ENV).ok().as_deref());
    if paused {
        return Some(Refusal::Paused);
    }
    let schema = SCHEMA_CHECK
        .state(expected_version(), Instant::now(), applied_version)
        .await;
    decide(paused, schema)
}

/// Check the schema once at process start so a mismatch is logged immediately
/// and the first request already has a verdict.
pub(crate) async fn verify_at_startup() {
    let schema = SCHEMA_CHECK
        .state(expected_version(), Instant::now(), applied_version)
        .await;
    if schema == SchemaState::Compatible {
        tracing::info!(
            catalog_version = expected_version(),
            "import writer catalog matches the database"
        );
    }
    if paused_from(std::env::var(PAUSE_ENV).ok().as_deref()) {
        tracing::warn!("{PAUSE_ENV} is set; backfill writes return 503");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[test]
    fn pause_flag_fails_closed_on_unknown_values() {
        for open in [
            None,
            Some(""),
            Some("0"),
            Some("false"),
            Some(" OFF "),
            Some("no"),
        ] {
            assert!(!paused_from(open), "{open:?}");
        }
        for paused in [
            Some("1"),
            Some("true"),
            Some("TRUE"),
            Some("on"),
            Some("pause"),
            Some("flase"),
        ] {
            assert!(paused_from(paused), "{paused:?}");
        }
    }

    #[test]
    fn pause_outranks_schema_and_mismatch_is_refused() {
        assert_eq!(decide(false, SchemaState::Compatible), None);
        assert_eq!(decide(true, SchemaState::Compatible), Some(Refusal::Paused));
        assert_eq!(decide(true, SchemaState::Mismatch), Some(Refusal::Paused));
        assert_eq!(
            decide(false, SchemaState::Mismatch),
            Some(Refusal::SchemaMismatch)
        );
    }

    #[test]
    fn only_an_exact_catalog_match_is_compatible() {
        assert_eq!(compare_versions(52, 52), SchemaState::Compatible);
        assert_eq!(compare_versions(52, 51), SchemaState::Mismatch);
        assert_eq!(compare_versions(52, 53), SchemaState::Mismatch);
        assert_eq!(compare_versions(52, 0), SchemaState::Mismatch);
    }

    #[tokio::test]
    async fn refusal_is_a_503_with_a_machine_code() {
        for (refusal, code) in [
            (Refusal::Paused, "imports_paused"),
            (Refusal::SchemaMismatch, "import_writer_schema_mismatch"),
        ] {
            let response = refusal.into_response();
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert!(response.headers().contains_key(RETRY_AFTER));
            let body = to_bytes(response.into_body(), 1024).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                body,
                json!({"error": "Imports are paused for an update", "code": code})
            );
        }
    }

    #[tokio::test]
    async fn schema_verdict_is_cached_then_refreshed_and_fails_closed() {
        let check = SchemaCheck::new();
        let start = Instant::now();
        assert_eq!(
            check.state(52, start, || async { Ok(52) }).await,
            SchemaState::Compatible
        );
        // Within the TTL the database is not queried again.
        assert_eq!(
            check
                .state(52, start + Duration::from_secs(1), || async {
                    panic!("cached verdict must not query")
                })
                .await,
            SchemaState::Compatible
        );
        // After the TTL a database migrated under the server is noticed.
        let later = start + SCHEMA_CACHE_TTL + Duration::from_secs(1);
        assert_eq!(
            check.state(52, later, || async { Ok(54) }).await,
            SchemaState::Mismatch
        );
        // A database that cannot be read is not assumed compatible.
        let failed = SchemaCheck::new();
        assert_eq!(
            failed
                .state(52, start, || async { Err(anyhow::anyhow!("unreachable")) })
                .await,
            SchemaState::Mismatch
        );
    }
}
