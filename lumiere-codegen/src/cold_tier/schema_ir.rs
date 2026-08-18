//! Stable Lumiere schema IR.
//!
//! `lumiere-codegen` normalizes SpacetimeDB-generated Rust bindings into this
//! manifest so every downstream generator (PG DDL, codecs, archive metadata,
//! hydration metadata) consumes one canonical representation instead of each
//! independently parsing generated source.
//!
//! Serialized as `crates/stdb-auth/assets/lumiere-schema-manifest.json`.

use serde::{Deserialize, Serialize};

/// Root manifest written to `lumiere-schema-manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LumiereSchemaManifest {
    /// Monotonically increasing version; bump when the IR shape changes.
    pub version: u32,
    /// All tables found in the generated Rust bindings, sorted by `sql_name`.
    pub tables: Vec<GeneratedTableSchema>,
    /// All enum types found in the generated Rust bindings, sorted by `rust_name`.
    pub enum_types: Vec<GeneratedEnumType>,
}

/// One SpacetimeDB table extracted from the generated Rust bindings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedTableSchema {
    /// CamelCase Rust struct name, e.g. `"AuditLog"`.
    pub rust_name: String,
    /// snake_case SQL table name, e.g. `"audit_log"`.
    pub sql_name: String,
    /// Primary key column.
    pub primary_key: GeneratedPrimaryKey,
    /// All columns in declaration order.
    pub columns: Vec<GeneratedColumn>,
    /// Non-PK indexes derived from the `IxCols` struct in the type file.
    pub indexes: Vec<GeneratedIndex>,
}

/// Primary key descriptor for a table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedPrimaryKey {
    /// Column name (snake_case), e.g. `"id"`.
    pub column_name: String,
    /// Rust type of the PK column.
    pub ty: GeneratedType,
}

/// One column of a SpacetimeDB table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedColumn {
    /// Rust field name (snake_case), e.g. `"organization_id"`.
    ///
    /// SpacetimeDB table fields use snake_case, so this is also the SQL column
    /// name. No camelCase conversion is needed for cold-tier columns.
    pub name: String,
    /// SQL column name.  For generated STDB bindings this is always identical
    /// to `name`, but we carry it explicitly so downstream generators do not
    /// need to re-derive it.
    pub sql_name: String,
    /// Logical type of the column (with `Option<T>` already unwrapped).
    pub ty: GeneratedType,
    /// True when the Rust field is `Option<T>`.
    pub nullable: bool,
}

/// An index on one or more columns of a table.
///
/// Derived from the `{TypeName}IxCols` struct in the generated type file.
/// Multi-column indexes are not represented in the generated SDK bindings in
/// the form we can currently extract; each entry here is a single-column index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedIndex {
    /// Suggested SQL index name, e.g. `"audit_log_organization_id"`.
    pub name: String,
    /// Columns covered by the index (currently always length 1).
    pub columns: Vec<String>,
    /// Whether this index enforces uniqueness.
    pub unique: bool,
}

/// Logical type of a SpacetimeDB column as understood by the cold-tier layer.
///
/// ## Type mapping rule (u64 / PG BIGINT)
///
/// `BIGINT` is signed and cannot represent the full `u64` domain losslessly.
/// The plan requires an explicit choice per deployment.  Generators should emit
/// `NUMERIC(20,0)` for `U64` columns unless overridden by a repository-wide
/// convention documented in the cold-tier plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GeneratedType {
    U8,
    U16,
    U32,
    /// Full unsigned 64-bit integer.  Map to `NUMERIC(20,0)` in PG.
    U64,
    I8,
    I16,
    I32,
    I64,
    F32,
    F64,
    Bool,
    /// UTF-8 text.  Map to `TEXT` in PG.
    String,
    /// SpacetimeDB `Timestamp` (microseconds since Unix epoch, signed i64).
    /// Map to `BIGINT` in PG.
    Timestamp,
    /// SpacetimeDB `Identity` (32-byte opaque identifier).  Map to `BYTEA` in PG.
    Identity,
    /// Ordered list.  Map to `JSONB` in PG (encoded as a JSON array).
    Vec(Box<GeneratedType>),
    /// Named enum type from the bindings.  Map to `TEXT` in PG (canonical variant name).
    Enum(String),
    /// Named struct type from the bindings (nested composite).
    /// Map to `JSONB` in PG (encoded as a JSON object).
    Struct(String),
}

/// One enum type found in the generated bindings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedEnumType {
    /// CamelCase Rust enum name, e.g. `"AccountMoveState"`.
    pub rust_name: String,
    /// Variant names in declaration order.
    pub variants: Vec<String>,
}
