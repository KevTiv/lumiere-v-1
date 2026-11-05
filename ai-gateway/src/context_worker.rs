use tracing::info;

use crate::state::AppState;

/// Background scanning has no actor credentials or current indexing grant.
/// Explicit bounded projection is available through `/v1/context/ingest`, which
/// reads the authoritative owner with the requesting actor's field permissions.
/// A scheduler may use it only with valid actor provenance; owner SQL is never a
/// substitute for that authority.
pub async fn run(_state: AppState) {
    info!("Activity indexing requires explicit actor-authorized references; automatic backfill is disabled");
}
