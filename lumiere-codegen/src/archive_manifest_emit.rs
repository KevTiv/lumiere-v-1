//! Archive manifest generator.
//!
//! Reads `lumiere-codegen/archive-candidates.json`, validates each candidate
//! against the schema IR, and emits `crates/stdb-auth/assets/archive-manifest.json`.
//!
//! ## Output format
//!
//! The archive manifest is consumed by:
//! - The api-server drainer worker (which tables to drain, finalize reducer name)
//! - The api-server read path (which tables have a cold counterpart)
//! - CI gates (validate tables/columns referenced actually exist in schema IR)
//!
//! ## Validation performed
//!
//! 1. Every `table` in `candidates` exists in the schema manifest.
//! 2. Every `scope.*` column referenced exists in the table's columns.
//! 3. Every `order_by.column` exists in the table's columns.
//! 4. The `finalize_reducer` name is non-empty.

use anyhow::{bail, Context, Result};
use serde_json::Value;

use crate::schema_ir::LumiereSchemaManifest;

/// Parse and validate `archive-candidates.json`, cross-reference with the schema
/// manifest, and return the serialised archive manifest JSON string.
pub fn emit_archive_manifest(
    candidates_json: &str,
    schema_manifest: &LumiereSchemaManifest,
) -> Result<String> {
    let config: Value =
        serde_json::from_str(candidates_json).context("parse archive-candidates.json")?;

    let candidates = config["candidates"]
        .as_array()
        .context("archive-candidates.json: missing 'candidates' array")?;

    let mut out_candidates: Vec<Value> = Vec::with_capacity(candidates.len());

    for (i, cand) in candidates.iter().enumerate() {
        let table = cand["table"]
            .as_str()
            .with_context(|| format!("candidates[{i}].table is not a string"))?;
        let cold_table = cand["cold_table"]
            .as_str()
            .with_context(|| format!("candidates[{i}].cold_table is not a string"))?;
        let mode = cand["mode"]
            .as_str()
            .with_context(|| format!("candidates[{i}].mode is not a string"))?;
        let finalize_reducer = cand["finalize_reducer"]
            .as_str()
            .with_context(|| format!("candidates[{i}].finalize_reducer is not a string"))?;

        if finalize_reducer.trim().is_empty() {
            bail!("candidates[{i}] (table '{table}'): finalize_reducer must not be empty");
        }

        // Validate table exists in schema manifest.
        let schema = schema_manifest
            .tables
            .iter()
            .find(|t| t.sql_name == table)
            .with_context(|| {
                format!(
                    "candidates[{i}]: table '{table}' not found in schema manifest. \
                     Re-run `make generate-stdb-rust-sdk && make codegen`."
                )
            })?;

        let column_names: Vec<&str> = schema.columns.iter().map(|c| c.name.as_str()).collect();

        // Validate scope columns.
        if let Some(scope) = cand["scope"].as_object() {
            for (role, col_val) in scope {
                let col = col_val
                    .as_str()
                    .with_context(|| format!("candidates[{i}].scope.{role} is not a string"))?;
                if !column_names.contains(&col) {
                    bail!(
                        "candidates[{i}] (table '{table}'): scope column '{col}' \
                         not found in schema. Available: {}",
                        column_names.join(", ")
                    );
                }
            }
        }

        // Validate order_by columns.
        if let Some(order_by) = cand["order_by"].as_array() {
            for (j, ob) in order_by.iter().enumerate() {
                let col = ob["column"].as_str().with_context(|| {
                    format!("candidates[{i}].order_by[{j}].column is not a string")
                })?;
                if !column_names.contains(&col) {
                    bail!(
                        "candidates[{i}] (table '{table}'): order_by column '{col}' \
                         not found in schema"
                    );
                }
            }
        }

        // Determine scope column names.
        let scope_columns: Vec<String> = cand["scope"]
            .as_object()
            .map(|o| {
                let mut vals: Vec<String> = o
                    .values()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect();
                vals.sort();
                vals
            })
            .unwrap_or_default();

        // Build the output entry.
        let pg_ddl_file = format!("api-server/src/generated/pg_ddl/{cold_table}.sql");
        let entry = serde_json::json!({
            "table": table,
            "cold_table": cold_table,
            "mode": mode,
            "rust_name": schema.rust_name,
            "primary_key": {
                "column_name": schema.primary_key.column_name,
                "rust_type": format!("{:?}", schema.primary_key.ty)
            },
            "scope_columns": scope_columns,
            "finalize_reducer": finalize_reducer,
            "order_by": cand["order_by"],
            "pg_ddl_file": pg_ddl_file
        });

        out_candidates.push(entry);
    }

    let manifest = serde_json::json!({
        "version": 1,
        "_comment": "Auto-generated by lumiere-codegen from archive-candidates.json + lumiere-schema-manifest.json. Do not edit.",
        "candidates": out_candidates
    });

    serde_json::to_string_pretty(&manifest).context("serialise archive manifest")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema_ir::*;

    fn minimal_manifest(table: &str) -> LumiereSchemaManifest {
        LumiereSchemaManifest {
            version: 1,
            tables: vec![GeneratedTableSchema {
                rust_name: "AuditLog".into(),
                sql_name: table.to_string(),
                primary_key: GeneratedPrimaryKey {
                    column_name: "id".into(),
                    ty: GeneratedType::U64,
                },
                columns: vec![
                    GeneratedColumn {
                        name: "id".into(),
                        sql_name: "id".into(),
                        ty: GeneratedType::U64,
                        nullable: false,
                    },
                    GeneratedColumn {
                        name: "organization_id".into(),
                        sql_name: "organization_id".into(),
                        ty: GeneratedType::U64,
                        nullable: false,
                    },
                    GeneratedColumn {
                        name: "company_id".into(),
                        sql_name: "company_id".into(),
                        ty: GeneratedType::U64,
                        nullable: true,
                    },
                ],
                indexes: vec![],
            }],
            enum_types: vec![],
        }
    }

    fn minimal_candidates_json(table: &str) -> String {
        serde_json::json!({
            "version": 1,
            "candidates": [{
                "table": table,
                "cold_table": format!("cold_{table}"),
                "mode": "append_only",
                "scope": { "organization_id": "organization_id", "company_id": "company_id" },
                "finalize_reducer": "finalize_audit_log_archive",
                "order_by": [{ "column": "id", "direction": "ASC" }]
            }]
        })
        .to_string()
    }

    #[test]
    fn emit_valid_candidate() {
        let manifest = minimal_manifest("audit_log");
        let candidates = minimal_candidates_json("audit_log");
        let out = emit_archive_manifest(&candidates, &manifest).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["candidates"][0]["table"], "audit_log");
        assert_eq!(parsed["candidates"][0]["rust_name"], "AuditLog");
        assert_eq!(parsed["candidates"][0]["primary_key"]["column_name"], "id");
    }

    #[test]
    fn missing_table_fails() {
        let manifest = minimal_manifest("audit_log");
        let candidates = minimal_candidates_json("nonexistent_table");
        assert!(emit_archive_manifest(&candidates, &manifest).is_err());
    }

    #[test]
    fn bad_scope_column_fails() {
        let manifest = minimal_manifest("audit_log");
        let candidates = serde_json::json!({
            "version": 1,
            "candidates": [{
                "table": "audit_log",
                "cold_table": "cold_audit_log",
                "mode": "append_only",
                "scope": { "organization_id": "no_such_column" },
                "finalize_reducer": "finalize_audit_log_archive",
                "order_by": [{ "column": "id", "direction": "ASC" }]
            }]
        })
        .to_string();
        assert!(emit_archive_manifest(&candidates, &manifest).is_err());
    }
}
