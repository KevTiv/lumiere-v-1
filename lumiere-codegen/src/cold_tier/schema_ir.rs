//! Stable Lumiere schema IR.
//!
//! `lumiere-codegen` normalizes SpacetimeDB-generated Rust bindings into this
//! manifest so every downstream generator (PG DDL, codecs, archive metadata,
//! hydration metadata) consumes one canonical representation instead of each
//! independently parsing generated source.
//!
//! Serialized as `crates/stdb-auth/assets/lumiere-schema-manifest.json`.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

/// Explicit exceptions for data owned by the platform rather than an ERP
/// organization. This list is intentionally closed: each exception names the
/// table and documents why no trusted organization can own it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlatformGlobalTable {
    pub sql_name: &'static str,
    pub rationale: &'static str,
}

/// The only platform-global tables allowed outside organization ownership.
pub const PLATFORM_GLOBAL_TABLES: [PlatformGlobalTable; 11] = [
    PlatformGlobalTable {
        sql_name: "cold_tier_service_identity",
        rationale: "Platform trust registry for the shared cold-tier service identity.",
    },
    PlatformGlobalTable {
        sql_name: "contact_identity_verification_authority",
        rationale: "Singleton provider trust anchor, not an organization role or CRM record.",
    },
    PlatformGlobalTable {
        sql_name: "country",
        rationale: "ISO country reference catalog seeded before any organization exists.",
    },
    PlatformGlobalTable {
        sql_name: "country_pack_definition",
        rationale: "Shared country-pack catalog used to activate organization-specific overlays.",
    },
    PlatformGlobalTable {
        sql_name: "country_pack_tax_rule",
        rationale: "Shared country-pack rules materialized into organization/company tax rows.",
    },
    PlatformGlobalTable {
        sql_name: "currency",
        rationale: "ISO currency catalog required during organization bootstrap.",
    },
    PlatformGlobalTable {
        sql_name: "hr_country_pack_leave_default",
        rationale: "Shared HR defaults materialized into organization leave types.",
    },
    PlatformGlobalTable {
        sql_name: "password_reset_token",
        rationale: "Identity-level token created before organization membership is established.",
    },
    PlatformGlobalTable {
        sql_name: "schema_migration",
        rationale:
            "Module-wide migration ledger; organization migrations use org_schema_migration.",
    },
    PlatformGlobalTable {
        sql_name: "user_credential",
        rationale: "Identity-level credential shared across organization memberships.",
    },
    PlatformGlobalTable {
        sql_name: "user_profile",
        rationale: "Identity-level profile shared across organization memberships.",
    },
];

/// Return the explicit platform classification for a SQL table name.
pub fn platform_global_table(sql_name: &str) -> Option<PlatformGlobalTable> {
    PLATFORM_GLOBAL_TABLES
        .iter()
        .copied()
        .find(|table| table.sql_name == sql_name)
}

/// Root manifest written to `lumiere-schema-manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LumiereSchemaManifest {
    /// Monotonically increasing version; bump when the serialized IR shape changes.
    pub version: u32,
    /// All tables found in the generated Rust bindings, sorted by `sql_name`.
    pub tables: Vec<GeneratedTableSchema>,
    /// All enum types found in the generated Rust bindings, sorted by `rust_name`.
    pub enum_types: Vec<GeneratedEnumType>,
}

/// Ownership classification derived from a table's generated schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeneratedTableOwnership {
    /// ERP application table carrying a direct organization ownership column.
    Organization,
    /// Explicitly classified platform infrastructure/reference table.
    PlatformGlobal(PlatformGlobalTable),
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

impl GeneratedTableSchema {
    /// Return the direct organization ownership column, when present.
    pub fn organization_column(&self) -> Option<&GeneratedColumn> {
        self.columns
            .iter()
            .find(|column| column.sql_name == "organization_id")
    }

    /// Validates and classifies this table for organization-routed storage.
    pub fn ownership(&self) -> Result<GeneratedTableOwnership> {
        let columns = self
            .columns
            .iter()
            .filter(|column| column.sql_name == "organization_id")
            .collect::<Vec<_>>();

        if let Some(platform) = platform_global_table(&self.sql_name) {
            if !columns.is_empty() {
                bail!(
                    "platform-global table {} must not declare organization_id; classify tenant-owned tables explicitly instead",
                    self.sql_name
                );
            }
            return Ok(GeneratedTableOwnership::PlatformGlobal(platform));
        }

        if columns.len() != 1 {
            bail!(
                "table {} must have exactly one direct organization_id column",
                self.sql_name
            );
        }
        let Some(organization_column) = self.organization_column() else {
            bail!(
                "table {} must have exactly one direct organization_id column",
                self.sql_name
            );
        };
        if organization_column.nullable {
            bail!("table {} organization_id must be non-null", self.sql_name);
        }
        if organization_column.ty != GeneratedType::U64 {
            bail!(
                "table {} organization_id must be U64, got {:?}",
                self.sql_name,
                organization_column.ty
            );
        }
        let organization_is_primary_key = self.primary_key.column_name == "organization_id";
        let has_organization_leading_index = self
            .indexes
            .iter()
            .any(|index| index.columns.first().map(String::as_str) == Some("organization_id"));
        if !organization_is_primary_key && !has_organization_leading_index {
            bail!(
                "table {} must have an organization-leading index",
                self.sql_name
            );
        }
        Ok(GeneratedTableOwnership::Organization)
    }
}

impl LumiereSchemaManifest {
    /// Classify every table and return ERP/platform ownership counts.
    pub fn ownership_counts(&self) -> Result<OwnershipCounts> {
        let mut counts = OwnershipCounts::default();
        for table in &self.tables {
            match table.ownership()? {
                GeneratedTableOwnership::Organization => counts.erp_owned_count += 1,
                GeneratedTableOwnership::PlatformGlobal(_) => counts.platform_global_count += 1,
            }
        }
        Ok(counts)
    }

    /// Enforce the C0 organization-ownership invariant for every ERP table.
    pub fn validate_tenant_ownership(&self) -> Result<()> {
        if self.tables.len() != 463 {
            bail!(
                "C0 requires 463 schema tables (452 ERP-owned + 11 platform-global), found {}",
                self.tables.len()
            );
        }
        let mut platform_tables = std::collections::BTreeSet::new();
        for table in &self.tables {
            if let GeneratedTableOwnership::PlatformGlobal(platform) = table.ownership()? {
                platform_tables.insert(platform.sql_name);
            }
        }
        if platform_tables.len() != PLATFORM_GLOBAL_TABLES.len() {
            let missing = PLATFORM_GLOBAL_TABLES
                .iter()
                .filter(|table| !platform_tables.contains(table.sql_name))
                .map(|table| table.sql_name)
                .collect::<Vec<_>>();
            bail!(
                "C0 platform-global allowlist mismatch: expected {} tables, found {}; missing {:?}",
                PLATFORM_GLOBAL_TABLES.len(),
                platform_tables.len(),
                missing
            );
        }
        Ok(())
    }
}

/// Counts emitted into generated schema-manifest reporting.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnershipCounts {
    pub erp_owned_count: usize,
    pub platform_global_count: usize,
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
    /// SQL column name. For generated STDB bindings this is always identical
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
/// The plan requires an explicit choice per deployment. Generators should emit
/// `NUMERIC(20,0)` for `U64` columns unless overridden by a repository-wide
/// convention documented in the cold-tier plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GeneratedType {
    U8,
    U16,
    U32,
    /// Full unsigned 64-bit integer. Map to `NUMERIC(20,0)` in PG.
    U64,
    I8,
    I16,
    I32,
    I64,
    F32,
    F64,
    Bool,
    /// UTF-8 text. Map to `TEXT` in PG.
    String,
    /// SpacetimeDB `Timestamp` (microseconds since Unix epoch, signed i64).
    /// Map to `BIGINT` in PG.
    Timestamp,
    /// SpacetimeDB `Identity` (32-byte opaque identifier). Map to `BYTEA` in PG.
    Identity,
    /// Ordered list. Map to `JSONB` in PG (encoded as a JSON array).
    Vec(Box<GeneratedType>),
    /// Named enum type from the bindings. Map to `TEXT` in PG (canonical variant name).
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

#[cfg(test)]
mod tests {
    use super::*;

    fn table(
        sql_name: &str,
        organization: Option<(GeneratedType, bool)>,
        indexed: bool,
    ) -> GeneratedTableSchema {
        let mut columns = vec![GeneratedColumn {
            name: "id".to_string(),
            sql_name: "id".to_string(),
            ty: GeneratedType::U64,
            nullable: false,
        }];
        if let Some((ty, nullable)) = organization {
            columns.push(GeneratedColumn {
                name: "organization_id".to_string(),
                sql_name: "organization_id".to_string(),
                ty,
                nullable,
            });
        }
        GeneratedTableSchema {
            rust_name: "Fixture".to_string(),
            sql_name: sql_name.to_string(),
            primary_key: GeneratedPrimaryKey {
                column_name: "id".to_string(),
                ty: GeneratedType::U64,
            },
            columns,
            indexes: indexed
                .then(|| GeneratedIndex {
                    name: format!("{sql_name}_organization_id"),
                    columns: vec!["organization_id".to_string()],
                    unique: false,
                })
                .into_iter()
                .collect(),
        }
    }

    #[test]
    fn platform_allowlist_is_exact_and_documented() {
        assert_eq!(PLATFORM_GLOBAL_TABLES.len(), 11);
        assert!(PLATFORM_GLOBAL_TABLES
            .iter()
            .all(|table| !table.sql_name.is_empty() && !table.rationale.is_empty()));
        let mut names = PLATFORM_GLOBAL_TABLES
            .iter()
            .map(|table| table.sql_name)
            .collect::<Vec<_>>();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), PLATFORM_GLOBAL_TABLES.len());
    }

    #[test]
    fn explicitly_global_table_without_ownership_is_allowed() {
        let table = table("currency", None, false);
        assert!(matches!(
            table.ownership(),
            Ok(GeneratedTableOwnership::PlatformGlobal(_))
        ));
    }

    #[test]
    fn platform_table_with_ownership_is_rejected() {
        let table = table("currency", Some((GeneratedType::U64, false)), true);
        let error = table.ownership().unwrap_err().to_string();
        assert!(error.contains("platform-global table currency"));
    }

    #[test]
    fn unknown_missing_ownership_is_rejected() {
        let table = table("orders", None, false);
        assert!(table
            .ownership()
            .unwrap_err()
            .to_string()
            .contains("organization_id"));
    }

    #[test]
    fn nullable_ownership_is_rejected() {
        let table = table("orders", Some((GeneratedType::U64, true)), true);
        assert!(table
            .ownership()
            .unwrap_err()
            .to_string()
            .contains("non-null"));
    }

    #[test]
    fn organization_table_requires_leading_index() {
        let table = table("orders", Some((GeneratedType::U64, false)), false);
        assert!(table
            .ownership()
            .unwrap_err()
            .to_string()
            .contains("organization-leading index"));
    }

    #[test]
    fn organization_primary_key_satisfies_leading_index() {
        let mut table = table(
            "organization_settings",
            Some((GeneratedType::U64, false)),
            false,
        );
        table.primary_key.column_name = "organization_id".to_string();
        assert_eq!(
            table.ownership().unwrap(),
            GeneratedTableOwnership::Organization
        );
    }

    #[test]
    fn ownership_counts_distinguish_platform_and_erp() {
        let manifest = LumiereSchemaManifest {
            version: 1,
            tables: vec![
                table("currency", None, false),
                table("orders", Some((GeneratedType::U64, false)), true),
            ],
            enum_types: vec![],
        };
        assert_eq!(
            manifest.ownership_counts().unwrap(),
            OwnershipCounts {
                erp_owned_count: 1,
                platform_global_count: 1,
            }
        );
    }

    #[test]
    fn c0_validation_requires_the_closed_platform_allowlist() {
        let manifest = LumiereSchemaManifest {
            version: 1,
            tables: vec![table("orders", Some((GeneratedType::U64, false)), true); 463],
            enum_types: vec![],
        };
        let error = manifest
            .validate_tenant_ownership()
            .unwrap_err()
            .to_string();
        assert!(error.contains("platform-global allowlist mismatch"));
    }
}
