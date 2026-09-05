//! Atomic commit projection façade.

mod apply;
mod checksum;
mod prepare;
mod sql;
#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;

pub use apply::apply_commit;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationCommitEnvelope {
    pub id: String,
    pub organization_id: u64,
    pub sequence: u64,
    pub operation_id: String,
    pub correlation_id: String,
    pub change_schema_version: u32,
    pub contract_version: String,
    pub occurred_at_micros: i64,
    pub actor_identity_hex: String,
    pub row_change_count: u32,
    pub checksum: String,
}

/// Transport-neutral representation of one ordered row change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationRowChangeInput {
    pub id: String,
    pub organization_id: u64,
    pub commit_sequence: u64,
    pub ordinal: u32,
    pub table_name: String,
    pub row_identity_json: String,
    pub change_kind: String,
    pub row_json: Option<String>,
    pub checksum: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionResult {
    Applied,
    AlreadyApplied,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SequenceDisposition {
    Apply,
    AlreadyApplied,
}

#[derive(Debug, Clone)]
struct ProjectionCodec {
    table_name: String,
    projection_mode: ProjectionMode,
    primary_key: String,
    organization_column: String,
    organization_partitioned: bool,
    columns: Vec<super::pg_codec::ColumnCodec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectionMode {
    UpsertCurrent,
    AppendHistory,
}

#[derive(Debug)]
struct PreparedChange {
    input: OrganizationRowChangeInput,
    codec: ProjectionCodec,
    values: Vec<super::pg_codec::PgValue>,
    key_value: super::pg_codec::PgValue,
}

pub(crate) const CHANGE_SCHEMA_VERSION: u32 = 1;
pub(crate) const CONTRACT_VERSION: &str = "ir-v2";
