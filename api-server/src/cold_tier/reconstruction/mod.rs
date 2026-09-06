//! Bounded, fenced, idempotent organization reconstruction orchestration.
//!
//! PostgreSQL is the durable source, while typed sink adapters keep
//! SpacetimeDB as the only writable business-state engine. No caller-selected
//! relation, reducer, SQL, or row payload crosses this boundary.

pub const RECONSTRUCTION_MANIFEST_JSON: &str =
    lumiere_contracts::manifests::RECONSTRUCTION_MANIFEST;
const MAX_BATCH_SIZE: u32 = 256;
const MAX_DIGEST_ROWS: usize = 100_000;

mod catalog;
mod coordinator;
mod coverage;
mod integrity;
mod operator;
mod postgres_source;
mod protocol;
mod stdb_sink;

pub use catalog::{RestoreCatalog, RestoreTable};
pub use coordinator::{reconstruct_organization, reconstruct_organization_once};
pub use coverage::{capture_coverage_snapshot, ReconstructionCoverageReport};
pub use operator::run_organization_reconstruction;
pub(crate) use stdb_sink::{normalize_stdb_digest_row, stdb_sql_field_name};
#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
pub use postgres_source::PgReconstructionSource;
pub use protocol::{
    ApplyDisposition, DurableWatermark, ReconstructionFence, ReconstructionReport,
    ReconstructionSink, ReconstructionSource, RestoreRow, TableDigest,
};
pub use stdb_sink::StdbReconstructionSink;
