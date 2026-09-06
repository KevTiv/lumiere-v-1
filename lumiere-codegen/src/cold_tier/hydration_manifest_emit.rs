//! Hydration manifest generator.
//!
//! Hydration is an aggregate operation, not a caller-selected row copy. The
//! authored input identifies the coolable aggregate and the server-derived
//! placement generation contract. Organization/company scope, aggregate
//! membership, and durable schema identity are derived from authoritative
//! generated manifests.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{bail, Context, Result};
use serde_json::{Map, Value};

use crate::cold_tier::schema_ir::LumiereSchemaManifest;

const SERVER_GENERATION_SOURCE: &str = "server_derived";
const CHECKSUM_ALGORITHM: &str = "sha256";

/// Emit the legacy reducer hydration manifest.
///
/// This entry point remains for callers that only have schema and archive
/// metadata. Mutable aggregate policies must use
/// [`emit_hydration_manifest_with_contracts`].
pub fn emit_hydration_manifest(
    policies_json: &str,
    schema_manifest: &LumiereSchemaManifest,
    archive_tables: &[String],
) -> Result<String> {
    let config: Value =
        serde_json::from_str(policies_json).context("parse hydration-policies.json")?;
    let policies = config["policies"]
        .as_array()
        .context("hydration-policies.json: missing 'policies' array")?;

    let mut out = Vec::with_capacity(policies.len());
    for (i, policy) in policies.iter().enumerate() {
        let reducer = policy["reducer"]
            .as_str()
            .with_context(|| format!("policies[{i}].reducer is not a string"))?;
        let table = policy["table"]
            .as_str()
            .with_context(|| format!("policies[{i}].table is not a string"))?;
        let id_arg = policy["id_arg"]
            .as_str()
            .with_context(|| format!("policies[{i}].id_arg is not a string"))?;
        validate_reducer_policy(i, reducer, table, id_arg, schema_manifest, archive_tables)?;
        out.push(serde_json::json!({
            "reducer": reducer,
            "table": table,
            "id_arg": id_arg,
        }));
    }

    emit_manifest(out)
}

/// Emit a hydration manifest with the complete mutable aggregate contract.
///
/// Both generated manifests are required so a caller cannot provide a stale
/// schema checksum or invent an aggregate parent. Every coolable mutable
/// aggregate must have an authored hydration policy; omission fails closed.
pub fn emit_hydration_manifest_with_contracts(
    policies_json: &str,
    schema_manifest: &LumiereSchemaManifest,
    archive_tables: &[String],
    storage_policy_manifest: &Value,
    durable_schema_manifest: &Value,
) -> Result<String> {
    let config: Value =
        serde_json::from_str(policies_json).context("parse hydration-policies.json")?;
    if config["version"] != 1 {
        bail!("hydration policy version must be 1");
    }
    let authored = config["policies"]
        .as_array()
        .context("hydration-policies.json: missing 'policies' array")?;
    let storage = storage_policies(storage_policy_manifest)?;
    let durable = durable_tables(durable_schema_manifest)?;

    let mut by_table = BTreeMap::new();
    for (i, policy) in authored.iter().enumerate() {
        let table = policy["table"]
            .as_str()
            .with_context(|| format!("policies[{i}].table is not a string"))?;
        if table.trim().is_empty() {
            bail!("policies[{i}].table must not be empty");
        }
        if by_table.insert(table.to_owned(), (i, policy)).is_some() {
            bail!("policies[{i}]: duplicate table '{table}'");
        }
    }

    let required = storage
        .iter()
        .filter(|(_, policy)| is_coolable_mutable(policy))
        .map(|(table, _)| table.clone())
        .collect::<BTreeSet<_>>();
    for table in &required {
        if !by_table.contains_key(table) {
            bail!("coolable mutable aggregate '{table}' lacks a hydration policy; refusing to generate an incomplete manifest");
        }
    }

    let mut out = Vec::with_capacity(authored.len());
    for (table, (i, policy)) in by_table {
        let storage_policy = storage
            .get(&table)
            .with_context(|| format!("policies[{i}]: table '{table}' has no storage policy"))?;
        schema_manifest
            .tables
            .iter()
            .find(|schema| schema.sql_name == table)
            .with_context(|| {
                format!("policies[{i}]: table '{table}' not found in schema manifest")
            })?;
        if !archive_tables.iter().any(|candidate| candidate == &table) {
            bail!("policies[{i}] (table '{table}'): table is not an active archive candidate");
        }

        let aggregate = policy["aggregate_membership"].as_array().with_context(|| {
            format!("policies[{i}] (table '{table}'): aggregate_membership must be an array")
        })?;
        let expected_members = aggregate_members(&storage, &table);
        let declared_members = aggregate
            .iter()
            .map(|member| {
                member.as_str().map(str::to_owned).with_context(|| {
                    format!("policies[{i}] (table '{table}'): aggregate_membership entries must be strings")
                })
            })
            .collect::<Result<BTreeSet<_>>>()?;
        if declared_members != expected_members {
            bail!("policies[{i}] (table '{table}'): aggregate_membership must exactly match storage-policy parent links; expected [{}]", expected_members.iter().cloned().collect::<Vec<_>>().join(", "));
        }

        let placement_source = policy["placement_generation_source"]
            .as_str()
            .with_context(|| {
                format!("policies[{i}] (table '{table}'): placement_generation_source is required")
            })?;
        if placement_source != SERVER_GENERATION_SOURCE {
            bail!("policies[{i}] (table '{table}'): placement generation must be {SERVER_GENERATION_SOURCE}, never caller-supplied");
        }

        let durable_entry = durable.get(&table).with_context(|| {
            format!("policies[{i}] (table '{table}'): durable schema entry is missing")
        })?;
        let schema_checksum = durable_entry["schema_checksum"]
            .as_str()
            .with_context(|| format!("durable schema '{table}' lacks schema_checksum"))?;
        let schema_version = durable_schema_manifest["migration"]["version"]
            .as_u64()
            .context("durable schema manifest migration.version must be an integer")?;
        if storage_policy["primary_key"]["version_strategy"].as_str() != Some("archive_version") {
            bail!("policies[{i}] (table '{table}'): coolable mutable hydration requires primary_key.version_strategy archive_version");
        }
        let organization_column = storage_policy["organization_column"]
            .as_str()
            .filter(|column| !column.trim().is_empty())
            .with_context(|| format!("storage policy '{table}' lacks organization_column"))?;
        let company = storage_policy["company_column_path"]
            .as_array()
            .with_context(|| format!("storage policy '{table}' lacks company_column_path"))?;
        if company.is_empty() {
            bail!("storage policy '{table}' lacks complete company scope metadata");
        }
        let company_path = company
            .iter()
            .map(|value| value.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()
            .with_context(|| format!("storage policy '{table}' company_column_path is invalid"))?;

        let mut membership = Map::new();
        for member in &expected_members {
            let member_entry = durable.get(member).with_context(|| {
                format!("aggregate '{table}' member '{member}' lacks durable schema metadata")
            })?;
            let member_checksum = member_entry["schema_checksum"]
                .as_str()
                .with_context(|| format!("durable schema '{member}' lacks schema_checksum"))?;
            membership.insert(
                member.clone(),
                serde_json::json!({
                    "schema_version": schema_version,
                    "schema_checksum": member_checksum,
                }),
            );
        }

        let mut entry = serde_json::json!({
            "table": table,
            "organization": { "column": organization_column, "source": "session" },
            "company": { "column_path": company_path, "source": "validated_parent" },
            "placement_generation": { "source": placement_source },
            "durable": {
                "schema_version": schema_version,
                "schema_checksum": schema_checksum,
                "version_column": "archive_version",
                "checksum_column": "payload_checksum",
                "checksum_algorithm": CHECKSUM_ALGORITHM,
            },
            "aggregate_membership": Value::Object(membership),
        });
        if let (Some(reducer), Some(id_arg)) =
            (policy["reducer"].as_str(), policy["id_arg"].as_str())
        {
            validate_reducer_policy(i, reducer, &table, id_arg, schema_manifest, archive_tables)?;
            entry["reducer"] = Value::String(reducer.to_owned());
            entry["id_arg"] = Value::String(id_arg.to_owned());
        } else if policy.get("reducer").is_some() || policy.get("id_arg").is_some() {
            bail!("policies[{i}] (table '{table}'): reducer and id_arg must be supplied together");
        }
        out.push(entry);
    }

    emit_manifest(out)
}

fn validate_reducer_policy(
    index: usize,
    reducer: &str,
    table: &str,
    id_arg: &str,
    schema_manifest: &LumiereSchemaManifest,
    archive_tables: &[String],
) -> Result<()> {
    if reducer.trim().is_empty() {
        bail!("policies[{index}]: reducer must not be empty");
    }
    if table.trim().is_empty() {
        bail!("policies[{index}]: table must not be empty");
    }
    if id_arg.trim().is_empty() || !id_arg.trim().starts_with("args.") {
        bail!("policies[{index}] (reducer '{reducer}'): id_arg must be a dotted path beginning with 'args.'");
    }
    if !schema_manifest
        .tables
        .iter()
        .any(|schema| schema.sql_name == table)
    {
        bail!(
            "policies[{index}] (reducer '{reducer}'): table '{table}' not found in schema manifest"
        );
    }
    if !archive_tables.iter().any(|candidate| candidate == table) {
        bail!("policies[{index}] (reducer '{reducer}'): table '{table}' is not an active archive candidate");
    }
    Ok(())
}

fn storage_policies(manifest: &Value) -> Result<BTreeMap<String, Value>> {
    if manifest["version"] != 1 {
        bail!("storage policy manifest version must be 1");
    }
    let policies = manifest["policies"]
        .as_array()
        .context("storage policy manifest: missing 'policies' array")?;
    let mut result = BTreeMap::new();
    for (i, policy) in policies.iter().enumerate() {
        let table = policy["table"]
            .as_str()
            .with_context(|| format!("storage policies[{i}].table is not a string"))?;
        if result.insert(table.to_owned(), policy.clone()).is_some() {
            bail!("storage policy manifest has duplicate table '{table}'");
        }
    }
    Ok(result)
}

fn durable_tables(manifest: &Value) -> Result<BTreeMap<String, Value>> {
    if manifest["version"] != 1 {
        bail!("durable schema manifest version must be 1");
    }
    let tables = manifest["tables"]
        .as_object()
        .context("durable schema manifest: missing 'tables' object")?;
    Ok(tables
        .iter()
        .map(|(table, entry)| (table.clone(), entry.clone()))
        .collect())
}

fn is_coolable_mutable(policy: &Value) -> bool {
    policy["cooling_eligibility"].as_str() != Some("never")
        && policy["projection_mode"].as_str() == Some("upsert-current")
        && policy["hydration_policy"]
            .as_str()
            .is_some_and(|value| matches!(value, "aggregate" | "full_row"))
}

fn aggregate_members(storage: &BTreeMap<String, Value>, root: &str) -> BTreeSet<String> {
    let mut members = BTreeSet::from([root.to_owned()]);
    let mut changed = true;
    while changed {
        changed = false;
        for (table, policy) in storage {
            let parent = policy["aggregate"]["parent"]["table"].as_str();
            if parent.is_some_and(|parent| members.contains(parent))
                && members.insert(table.clone())
            {
                changed = true;
            }
        }
    }
    members
}

fn emit_manifest(policies: Vec<Value>) -> Result<String> {
    let manifest = serde_json::json!({
        "version": 1,
        "_comment": "Auto-generated by lumiere-codegen from hydration-policies.json and durable manifests. Do not edit.",
        "policies": policies,
    });
    serde_json::to_string_pretty(&manifest).context("serialise hydration manifest")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cold_tier::schema_ir::*;

    fn manifest_with(table: &str) -> LumiereSchemaManifest {
        LumiereSchemaManifest {
            version: 1,
            tables: vec![GeneratedTableSchema {
                rust_name: "SaleOrder".into(),
                sql_name: table.to_string(),
                primary_key: GeneratedPrimaryKey {
                    column_name: "id".into(),
                    ty: GeneratedType::U64,
                },
                columns: vec![GeneratedColumn {
                    name: "id".into(),
                    sql_name: "id".into(),
                    ty: GeneratedType::U64,
                    nullable: false,
                }],
                indexes: vec![],
            }],
            enum_types: vec![],
        }
    }

    #[test]
    fn empty_policies_emit_empty_manifest() {
        let out = emit_hydration_manifest(
            r#"{"version":1,"policies":[]}"#,
            &manifest_with("sale_order"),
            &["sale_order".into()],
        )
        .unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["version"], 1);
        assert_eq!(parsed["policies"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn legacy_policy_validation_remains_supported() {
        let out = emit_hydration_manifest(r#"{"version":1,"policies":[{"reducer":"confirm_sale_order","table":"sale_order","id_arg":"args.order_id"}]}"#, &manifest_with("sale_order"), &["sale_order".into()]).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["policies"][0]["id_arg"], "args.order_id");
    }

    #[test]
    fn incomplete_mutable_policy_fails_closed() {
        let storage = serde_json::json!({"version":1,"policies":[{"table":"sale_order","cooling_eligibility":"policy","projection_mode":"upsert-current","hydration_policy":"full_row","primary_key":{"version_strategy":"archive_version"}}]});
        let durable = serde_json::json!({"version":1,"migration":{"version":1},"tables":{"sale_order":{"schema_checksum":"sha256:abc"}}});
        let err = emit_hydration_manifest_with_contracts(
            r#"{"version":1,"policies":[]}"#,
            &manifest_with("sale_order"),
            &["sale_order".into()],
            &storage,
            &durable,
        )
        .unwrap_err();
        assert!(err.to_string().contains("lacks a hydration policy"));
    }

    #[test]
    fn mutable_policy_emits_derived_contract() {
        let storage = serde_json::json!({"version":1,"policies":[{"table":"sale_order","cooling_eligibility":"policy","projection_mode":"upsert-current","hydration_policy":"full_row","organization_column":"organization_id","company_column_path":["company_id"],"primary_key":{"version_strategy":"archive_version"},"aggregate":{"parent":null}}]});
        let durable = serde_json::json!({"version":1,"migration":{"version":7},"tables":{"sale_order":{"schema_checksum":"sha256:abc"}}});
        let input = r#"{"version":1,"policies":[{"table":"sale_order","placement_generation_source":"server_derived","aggregate_membership":["sale_order"]}]}"#;
        let parsed: Value = serde_json::from_str(
            &emit_hydration_manifest_with_contracts(
                input,
                &manifest_with("sale_order"),
                &["sale_order".into()],
                &storage,
                &durable,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(parsed["policies"][0]["organization"]["source"], "session");
        assert_eq!(parsed["policies"][0]["durable"]["schema_version"], 7);
        assert_eq!(
            parsed["policies"][0]["durable"]["schema_checksum"],
            "sha256:abc"
        );
        assert_eq!(
            parsed["policies"][0]["aggregate_membership"]["sale_order"]["schema_checksum"],
            "sha256:abc"
        );
    }
}
