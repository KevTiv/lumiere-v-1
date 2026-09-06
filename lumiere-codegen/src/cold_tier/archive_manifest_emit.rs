//! Archive manifest generator.
//!
//! Derives the archive-capable subset of the total reviewed storage policy,
//! validates each candidate against the schema IR, and emits
//! `crates/stdb-auth/assets/archive-manifest.json`.
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

use std::collections::BTreeSet;

use anyhow::{bail, Context, Result};
#[cfg(test)]
use serde_json::Value;

use crate::cold_tier::schema_ir::LumiereSchemaManifest;
use crate::cold_tier::storage_policy_manifest_emit::{
    AggregateKind, ArchivePolicy, CoolingEligibility, DependencyBehavior, HydrationPolicy,
    StorageClass, StoragePolicyConfig,
};

/// Generate the archive subset from the total storage-policy census.
///
/// The retired candidate list was a second, manually maintained source of
/// truth. A policy is now archive-capable only when it explicitly declares
/// cooling eligibility and its reviewed archive metadata. This keeps DDL,
/// codecs, and hydration consumers on the same generated subset.
pub fn emit_archive_manifest_from_storage_policy(
    policy_json: &str,
    schema_manifest: &LumiereSchemaManifest,
) -> Result<String> {
    let config: StoragePolicyConfig =
        serde_json::from_str(policy_json).context("parse storage-policy-manifest.json")?;
    if config.version != 1 {
        bail!("storage policy version must be 1, found {}", config.version);
    }
    if config.policies.len() != schema_manifest.tables.len() {
        bail!(
            "archive generation requires total storage-policy coverage: {} policies for {} schema tables",
            config.policies.len(),
            schema_manifest.tables.len()
        );
    }
    let mut reviewed_tables = BTreeSet::new();
    for (index, policy) in config.policies.iter().enumerate() {
        if !policy.cooling_eligibility_source.starts_with("reviewed:") {
            bail!(
                "policies[{index}] ('{}'): cooling decision has not been reviewed",
                policy.table
            );
        }
        if !reviewed_tables.insert(policy.table.as_str()) {
            bail!("policies[{index}]: duplicate table '{}'", policy.table);
        }
    }
    for table in &schema_manifest.tables {
        if !reviewed_tables.contains(table.sql_name.as_str()) {
            bail!(
                "archive generation requires a reviewed policy for schema table '{}'",
                table.sql_name
            );
        }
    }
    let mut out_candidates = Vec::new();

    for (index, policy) in config.policies.iter().enumerate() {
        let Some(archive) = policy.archive.as_ref() else {
            let inherits_parent_archive = policy.aggregate.kind == AggregateKind::Child
                && policy.cooling_eligibility == CoolingEligibility::Parent
                && policy.dependency_behavior == DependencyBehavior::FollowParent
                && policy.hydration_policy == HydrationPolicy::Parent;
            if inherits_parent_archive {
                continue;
            }
            if policy.cooling_eligibility != CoolingEligibility::Never {
                bail!(
                    "policies[{index}] ('{}'): cooling-eligible policy lacks archive metadata",
                    policy.table
                );
            }
            continue;
        };
        if policy.cooling_eligibility == CoolingEligibility::Never {
            bail!(
                "policies[{index}] ('{}'): archive metadata requires cooling eligibility",
                policy.table
            );
        }
        let schema = schema_manifest
            .tables
            .iter()
            .find(|table| table.sql_name == policy.table)
            .with_context(|| {
                format!(
                    "storage policy '{}': table not found in schema manifest",
                    policy.table
                )
            })?;
        validate_archive_entry(&policy.table, archive, schema)?;
        let mut scope = serde_json::Map::new();
        for (role, column) in &archive.scope {
            scope.insert(role.clone(), serde_json::Value::String(column.clone()));
        }
        let mode = serde_json::Value::String(archive.mode.clone());
        let order_by = serde_json::to_value(&archive.order_by)
            .context("serialise storage policy archive ordering")?;
        let entry = serde_json::json!({
            "table": policy.table,
            "cold_table": archive.cold_table,
            "mode": mode,
            "rust_name": schema.rust_name,
            "primary_key": {
                "column_name": schema.primary_key.column_name,
                "rust_type": format!("{:?}", schema.primary_key.ty)
            },
            "scope": scope,
            "scope_columns": archive.scope.values().cloned().collect::<Vec<_>>(),
            "finalize_reducer": archive.finalize_reducer,
            "order_by": order_by,
            "storage_class": StorageClass::for_policy(policy),
            "cooling_eligibility": policy.cooling_eligibility,
            "semantic_eligibility": policy.semantic_eligibility,
            "aggregate": policy.aggregate,
            "dependency_behavior": policy.dependency_behavior,
            "hydration_policy": policy.hydration_policy,
            "pg_ddl_file": format!("manifests/pg_ddl/{}.sql", archive.cold_table)
        });
        out_candidates.push(entry);
    }

    let manifest = serde_json::json!({
        "version": 1,
        "_comment": "Auto-generated by lumiere-codegen from storage-policy-manifest.json + lumiere-schema-manifest.json. Do not edit.",
        "candidates": out_candidates
    });
    serde_json::to_string_pretty(&manifest).context("serialise archive manifest")
}

fn validate_archive_entry(
    table: &str,
    archive: &ArchivePolicy,
    schema: &crate::cold_tier::schema_ir::GeneratedTableSchema,
) -> Result<()> {
    if archive.cold_table.trim().is_empty()
        || archive.finalize_reducer.trim().is_empty()
        || archive.order_by.is_empty()
    {
        bail!("storage policy '{table}': archive metadata is incomplete");
    }
    let columns = schema
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<Vec<_>>();
    for (role, column) in &archive.scope {
        if !columns.contains(&column.as_str()) {
            bail!(
                "storage policy '{table}': archive scope column '{column}' for '{role}' not found in schema"
            );
        }
    }
    for order in &archive.order_by {
        if !columns.contains(&order.column.as_str()) {
            bail!(
                "storage policy '{table}': archive order_by column '{}' not found in schema",
                order.column
            );
        }
        if !matches!(order.direction.as_str(), "ASC" | "DESC") {
            bail!(
                "storage policy '{table}': archive order_by direction '{}' must be ASC or DESC",
                order.direction
            );
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cold_tier::schema_ir::*;

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

    fn minimal_storage_policy_json(table: &str, cooling: &str, archive: Value) -> String {
        serde_json::json!({
            "version": 1,
            "reviewed_fixtures": [{
                "table": table,
                "module": "core",
                "storage_class": "short_hot_tail",
                "reviewed": true
            }],
            "policies": [{
                "table": table,
                "module": "core",
                "rationale": "fixture",
                "authoritative_resources": [],
                "durability_class": "durable_history",
                "organization_ownership": "direct",
                "organization_column": "organization_id",
                "company_ownership": "direct",
                "company_column_path": ["company_id"],
                "company_column_nullable": true,
                "aggregate": { "kind": "root", "parent": null },
                "primary_key": { "strategy": "auto_increment", "column": "id", "version_strategy": "none" },
                "projection_mode": "append-history",
                "hot_retention": "time_window",
                "cooling_eligibility": cooling,
                "cooling_eligibility_source": "reviewed:fixture",
                "dependency_behavior": "independent",
                "hydration_policy": "not_applicable",
                "delete_behavior": "append_only",
                "postgres_access_path": "organization_partition",
                "archive": archive
            }]
        })
        .to_string()
    }

    #[test]
    fn archive_subset_is_generated_from_cooling_policy() {
        let manifest = minimal_manifest("audit_log");
        let policy = serde_json::json!({
            "cold_table": "cold_audit_log",
            "mode": "append_only",
            "scope": { "organization_id": "organization_id", "company_id": "company_id" },
            "finalize_reducer": "finalize_audit_log_archive",
            "order_by": [{ "column": "id", "direction": "ASC" }]
        });
        let out = emit_archive_manifest_from_storage_policy(
            &minimal_storage_policy_json("audit_log", "policy", policy),
            &manifest,
        )
        .unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["version"], 1);
        assert_eq!(parsed["candidates"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["candidates"][0]["storage_class"], "short_hot_tail");
        assert_eq!(
            parsed["candidates"][0]["semantic_eligibility"]["durable_watermark"],
            "required"
        );
    }

    #[test]
    fn never_cooled_policy_is_not_an_archive_candidate() {
        let manifest = minimal_manifest("audit_log");
        let out = emit_archive_manifest_from_storage_policy(
            &minimal_storage_policy_json("audit_log", "never", Value::Null),
            &manifest,
        )
        .unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert!(parsed["candidates"].as_array().unwrap().is_empty());
    }

    #[test]
    fn archive_generation_rejects_unreviewed_or_incomplete_policy_census() {
        let manifest = minimal_manifest("audit_log");
        let mut unreviewed: Value = serde_json::from_str(&minimal_storage_policy_json(
            "audit_log",
            "never",
            Value::Null,
        ))
        .unwrap();
        unreviewed["policies"][0]["cooling_eligibility_source"] =
            Value::String("generated default".into());
        assert!(
            emit_archive_manifest_from_storage_policy(&unreviewed.to_string(), &manifest)
                .unwrap_err()
                .to_string()
                .contains("has not been reviewed")
        );

        let incomplete = serde_json::json!({
            "version": 1,
            "policies": [],
            "reviewed_fixtures": []
        });
        assert!(
            emit_archive_manifest_from_storage_policy(&incomplete.to_string(), &manifest)
                .unwrap_err()
                .to_string()
                .contains("total storage-policy coverage")
        );
    }
}
