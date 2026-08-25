use tracing::warn;

use crate::state::AppState;

/// Activity indexing stays disabled until an approved indexing projection can
/// supply policy-filtered embedding text. Reading raw ERP tables with the owner
/// client would bypass the same capability and field policies enforced for
/// authoritative snapshots.
pub async fn run(_state: AppState) {
    warn!("Activity indexing is disabled pending an authorized indexing projection");
}
