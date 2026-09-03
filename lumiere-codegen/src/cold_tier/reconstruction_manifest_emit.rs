//! C7 reconstruction relationship metadata and deterministic restore ordering.
//!
//! SpacetimeDB bindings expose columns and indexes but not a complete foreign
//! key graph. The reviewed storage-policy aggregate parent links are therefore
//! the authoritative relationship input. This generator validates those links
//! against schema IR, rejects cycles and unsafe restore phases, and emits a
//! stable parent-before-child order for per-organization reconstruction.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::cold_tier::schema_ir::{GeneratedTableSchema, LumiereSchemaManifest};

const RESTORE: &str = "restore";
const RECREATE: &str = "recreate";
const EXCLUDE_PLATFORM: &str = "exclude_platform";

#[derive(Debug, Deserialize)]
struct ReconstructionPolicy {
    version: u32,
    same_level_order: String,
    relationship_source: String,
    durability_actions: BTreeMap<String, String>,
    #[serde(default)]
    table_actions: BTreeMap<String, String>,
    recreated_state: BTreeMap<String, String>,
    excluded_state: BTreeMap<String, String>,
}

#[derive(Debug)]
struct TablePlan {
    action: String,
    durability_class: String,
    module: String,
    organization_column: Option<String>,
    projection_mode: String,
    parent: Option<ParentLink>,
}

#[derive(Debug, Clone)]
struct ParentLink {
    table: String,
    child_column: String,
    parent_column: String,
}

/// Emit reviewed aggregate relationships and a deterministic reconstruction
/// plan. Every schema/storage table and durability class must be classified.
pub fn emit_reconstruction_manifest(
    policy_json: &str,
    schema: &LumiereSchemaManifest,
    storage: &Value,
    durable: &Value,
) -> Result<String> {
    let policy: ReconstructionPolicy =
        serde_json::from_str(policy_json).context("parse reconstruction-policy.json")?;
    validate_policy(&policy)?;
    if storage["version"] != 1 {
        bail!("storage policy manifest version must be 1");
    }
    if durable["version"] != 1 {
        bail!("durable schema manifest version must be 1");
    }

    let schema_by_name = schema
        .tables
        .iter()
        .map(|table| (table.sql_name.as_str(), table))
        .collect::<BTreeMap<_, _>>();
    let durable_tables = durable["tables"]
        .as_object()
        .context("durable schema manifest: missing tables object")?;
    let storage_policies = storage["policies"]
        .as_array()
        .context("storage policy manifest: missing policies array")?;

    let mut plans = BTreeMap::new();
    for (index, entry) in storage_policies.iter().enumerate() {
        let table = required_str(entry, "table", index)?;
        let durability_class = required_str(entry, "durability_class", index)?;
        let module = required_str(entry, "module", index)?;
        let projection_mode = required_str(entry, "projection_mode", index)?;
        let action = policy.table_actions.get(table).cloned().unwrap_or(
            policy
                .durability_actions
                .get(durability_class)
                .with_context(|| {
                    format!("table '{table}' has unreviewed durability class '{durability_class}'")
                })?
                .clone(),
        );
        let schema_table = schema_by_name
            .get(table)
            .with_context(|| format!("storage table '{table}' is absent from schema IR"))?;
        let is_platform = entry["organization_ownership"].as_str() == Some("platform_global");
        if (action == EXCLUDE_PLATFORM) != is_platform {
            bail!("table '{table}' action '{action}' disagrees with organization ownership");
        }
        if action != EXCLUDE_PLATFORM {
            let durable_entry = durable_tables.get(table).with_context(|| {
                format!("organization table '{table}' lacks durable schema metadata")
            })?;
            if durable_entry["applicable"] != true {
                bail!("organization table '{table}' is not applicable in durable schema metadata");
            }
        }
        let parent = parse_parent(entry, index)?;
        if let Some(link) = &parent {
            validate_parent_link(table, schema_table, link, &schema_by_name)?;
        }
        if plans
            .insert(
                table.to_owned(),
                TablePlan {
                    action,
                    durability_class: durability_class.to_owned(),
                    module: module.to_owned(),
                    organization_column: entry["organization_column"].as_str().map(str::to_owned),
                    projection_mode: projection_mode.to_owned(),
                    parent,
                },
            )
            .is_some()
        {
            bail!("duplicate storage policy table '{table}'");
        }
    }

    let schema_names = schema_by_name.keys().copied().collect::<BTreeSet<_>>();
    let plan_names = plans.keys().map(String::as_str).collect::<BTreeSet<_>>();
    if schema_names != plan_names {
        bail!("storage policy census must exactly cover schema IR tables");
    }
    for table in policy.table_actions.keys() {
        if !plans.contains_key(table) {
            bail!("reconstruction policy overrides unknown table '{table}'");
        }
    }
    validate_parent_actions(&plans)?;
    let ordered = topological_order(&plans)?;

    let relationships = ordered
        .iter()
        .filter_map(|table| {
            plans[table].parent.as_ref().map(|parent| {
                json!({
                    "kind": "aggregate_parent",
                    "child_table": table,
                    "child_column": parent.child_column,
                    "parent_table": parent.table,
                    "parent_column": parent.parent_column,
                })
            })
        })
        .collect::<Vec<_>>();
    let restore_order = ordered
        .iter()
        .filter(|table| plans[*table].action == RESTORE)
        .cloned()
        .collect::<Vec<_>>();
    let recreate_order = ordered
        .iter()
        .filter(|table| plans[*table].action == RECREATE)
        .cloned()
        .collect::<Vec<_>>();
    let excluded_tables = ordered
        .iter()
        .filter(|table| plans[*table].action == EXCLUDE_PLATFORM)
        .cloned()
        .collect::<Vec<_>>();
    let restore_tables = restore_order
        .iter()
        .enumerate()
        .map(|(index, table)| {
            let plan = &plans[table];
            let schema_table = schema_by_name[table.as_str()];
            let durable_entry = &durable_tables[table];
            let dependencies = plan
                .parent
                .as_ref()
                .filter(|parent| plans[&parent.table].action == RESTORE)
                .map(|parent| vec![parent.table.clone()])
                .unwrap_or_default();
            json!({
                "table": table,
                "module": plan.module,
                "state_class": plan.durability_class,
                "required_for_activation": true,
                "restore_order": index + 1,
                "dependencies": dependencies,
                "rust_type": schema_table.rust_name,
                "stdb_table_accessor": table,
                "primary_key": schema_table.primary_key.column_name,
                "organization_column": plan.organization_column,
                "projection_mode": plan.projection_mode,
                "durable_schema_checksum": durable_entry["schema_checksum"],
                "parent": plan.parent.as_ref().map(|parent| json!({
                    "table": parent.table,
                    "child_column": parent.child_column,
                    "parent_column": parent.parent_column,
                })),
            })
        })
        .collect::<Vec<_>>();

    let manifest = json!({
        "version": 1,
        "_comment": "Auto-generated by lumiere-codegen from reviewed reconstruction policy, storage policy, schema IR, and durable schema metadata. Do not edit.",
        "relationship_source": policy.relationship_source,
        "same_level_order": policy.same_level_order,
        "durable_schema": {
            "version": durable["migration"]["version"],
            "checksum": durable["migration"]["checksum"],
        },
        "relationships": relationships,
        "restore_order": restore_order,
        "recreate_order": recreate_order,
        "excluded_tables": excluded_tables,
        "recreated_state": policy.recreated_state,
        "excluded_state": policy.excluded_state,
        "tables": restore_tables,
        "coverage": {
            "schema_tables": plans.len(),
            "relationships": relationships.len(),
            "restore": restore_order.len(),
            "recreate": recreate_order.len(),
            "excluded": excluded_tables.len(),
        }
    });
    serde_json::to_string_pretty(&manifest).context("serialize reconstruction manifest")
}

fn validate_policy(policy: &ReconstructionPolicy) -> Result<()> {
    if policy.version != 1 {
        bail!("reconstruction policy version must be 1");
    }
    if policy.same_level_order != "table_ascending" {
        bail!("same_level_order must be table_ascending");
    }
    if policy.relationship_source != "storage_policy.aggregate.parent" {
        bail!("relationship_source must be storage_policy.aggregate.parent");
    }
    for action in policy.durability_actions.values() {
        if !matches!(action.as_str(), RESTORE | RECREATE | EXCLUDE_PLATFORM) {
            bail!("unsupported reconstruction action '{action}'");
        }
    }
    Ok(())
}

fn required_str<'a>(entry: &'a Value, field: &str, index: usize) -> Result<&'a str> {
    entry[field]
        .as_str()
        .filter(|value| !value.is_empty())
        .with_context(|| format!("storage policies[{index}].{field} is missing"))
}

fn parse_parent(entry: &Value, index: usize) -> Result<Option<ParentLink>> {
    let parent = &entry["aggregate"]["parent"];
    if parent.is_null() {
        return Ok(None);
    }
    Ok(Some(ParentLink {
        table: required_parent_str(parent, "table", index)?.to_owned(),
        child_column: required_parent_str(parent, "child_column", index)?.to_owned(),
        parent_column: required_parent_str(parent, "parent_column", index)?.to_owned(),
    }))
}

fn required_parent_str<'a>(parent: &'a Value, field: &str, index: usize) -> Result<&'a str> {
    parent[field]
        .as_str()
        .filter(|value| !value.is_empty())
        .with_context(|| format!("storage policies[{index}].aggregate.parent.{field} is missing"))
}

fn validate_parent_link(
    child_name: &str,
    child: &GeneratedTableSchema,
    link: &ParentLink,
    schema: &BTreeMap<&str, &GeneratedTableSchema>,
) -> Result<()> {
    if child_name == link.table {
        bail!("table '{child_name}' cannot be its own aggregate parent");
    }
    let parent = schema
        .get(link.table.as_str())
        .with_context(|| format!("table '{child_name}' names missing parent '{}'", link.table))?;
    let child_column = child
        .columns
        .iter()
        .find(|column| column.sql_name == link.child_column)
        .with_context(|| {
            format!(
                "table '{child_name}' lacks child relationship column '{}'",
                link.child_column
            )
        })?;
    let parent_column = parent
        .columns
        .iter()
        .find(|column| column.sql_name == link.parent_column)
        .with_context(|| {
            format!(
                "parent '{}' lacks relationship column '{}'",
                link.table, link.parent_column
            )
        })?;
    if child_column.ty != parent_column.ty {
        bail!(
            "relationship {child_name}.{} -> {}.{} has incompatible types",
            link.child_column,
            link.table,
            link.parent_column
        );
    }
    Ok(())
}

fn validate_parent_actions(plans: &BTreeMap<String, TablePlan>) -> Result<()> {
    for (table, plan) in plans {
        let Some(parent) = &plan.parent else { continue };
        let parent_plan = plans.get(&parent.table).with_context(|| {
            format!(
                "table '{table}' names unclassified parent '{}'",
                parent.table
            )
        })?;
        if plan.action != EXCLUDE_PLATFORM && parent_plan.action == EXCLUDE_PLATFORM {
            bail!(
                "organization table '{table}' cannot depend on excluded platform table '{}'",
                parent.table
            );
        }
        if plan.action == RESTORE && parent_plan.action == RECREATE {
            bail!(
                "restored table '{table}' cannot depend on later recreated parent '{}'",
                parent.table
            );
        }
    }
    Ok(())
}

fn topological_order(plans: &BTreeMap<String, TablePlan>) -> Result<Vec<String>> {
    let mut remaining = plans.keys().cloned().collect::<BTreeSet<_>>();
    let mut emitted = BTreeSet::new();
    let mut ordered = Vec::with_capacity(plans.len());
    while !remaining.is_empty() {
        let ready = remaining
            .iter()
            .filter(|table| {
                plans[*table]
                    .parent
                    .as_ref()
                    .is_none_or(|parent| emitted.contains(&parent.table))
            })
            .cloned()
            .collect::<Vec<_>>();
        if ready.is_empty() {
            bail!(
                "aggregate relationship graph contains a cycle involving [{}]",
                remaining.into_iter().collect::<Vec<_>>().join(", ")
            );
        }
        for table in ready {
            remaining.remove(&table);
            emitted.insert(table.clone());
            ordered.push(table);
        }
    }
    Ok(ordered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cold_tier::schema_ir::{GeneratedColumn, GeneratedPrimaryKey, GeneratedType};

    fn table(name: &str, columns: &[&str]) -> GeneratedTableSchema {
        GeneratedTableSchema {
            rust_name: name.to_owned(),
            sql_name: name.to_owned(),
            primary_key: GeneratedPrimaryKey {
                column_name: "id".into(),
                ty: GeneratedType::U64,
            },
            columns: columns
                .iter()
                .map(|name| GeneratedColumn {
                    name: (*name).into(),
                    sql_name: (*name).into(),
                    ty: GeneratedType::U64,
                    nullable: false,
                })
                .collect(),
            indexes: vec![],
        }
    }

    fn policy() -> &'static str {
        r#"{"version":1,"same_level_order":"table_ascending","relationship_source":"storage_policy.aggregate.parent","durability_actions":{"durable_business_record":"restore","derived_rebuildable":"recreate","platform_control":"exclude_platform"},"recreated_state":{},"excluded_state":{}}"#
    }

    fn durable(names: &[&str]) -> Value {
        let tables = names
            .iter()
            .map(|name| ((*name).to_owned(), json!({"applicable":true})))
            .collect::<serde_json::Map<_, _>>();
        json!({"version":1,"migration":{"version":1,"checksum":"sha256:test"},"tables":tables})
    }

    #[test]
    fn emits_parent_before_child_with_stable_peer_order() {
        let schema = LumiereSchemaManifest {
            version: 1,
            tables: vec![
                table("z_child", &["id", "root_id"]),
                table("a_peer", &["id"]),
                table("root", &["id"]),
            ],
            enum_types: vec![],
        };
        let storage = json!({"version":1,"policies":[
            {"table":"z_child","module":"test","durability_class":"durable_business_record","organization_ownership":"direct","organization_column":"organization_id","projection_mode":"upsert-current","aggregate":{"parent":{"table":"root","child_column":"root_id","parent_column":"id"}}},
            {"table":"root","module":"test","durability_class":"durable_business_record","organization_ownership":"direct","organization_column":"organization_id","projection_mode":"upsert-current","aggregate":{"parent":null}},
            {"table":"a_peer","module":"test","durability_class":"durable_business_record","organization_ownership":"direct","organization_column":"organization_id","projection_mode":"upsert-current","aggregate":{"parent":null}}
        ]});
        let manifest: Value = serde_json::from_str(
            &emit_reconstruction_manifest(
                policy(),
                &schema,
                &storage,
                &durable(&["z_child", "root", "a_peer"]),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            manifest["restore_order"],
            json!(["a_peer", "root", "z_child"])
        );
        assert_eq!(manifest["relationships"][0]["child_table"], "z_child");
    }

    #[test]
    fn rejects_relationship_cycles() {
        let schema = LumiereSchemaManifest {
            version: 1,
            tables: vec![table("a", &["id", "b_id"]), table("b", &["id", "a_id"])],
            enum_types: vec![],
        };
        let storage = json!({"version":1,"policies":[
            {"table":"a","module":"test","durability_class":"durable_business_record","organization_ownership":"direct","organization_column":"organization_id","projection_mode":"upsert-current","aggregate":{"parent":{"table":"b","child_column":"b_id","parent_column":"id"}}},
            {"table":"b","module":"test","durability_class":"durable_business_record","organization_ownership":"direct","organization_column":"organization_id","projection_mode":"upsert-current","aggregate":{"parent":{"table":"a","child_column":"a_id","parent_column":"id"}}}
        ]});
        let error =
            emit_reconstruction_manifest(policy(), &schema, &storage, &durable(&["a", "b"]))
                .unwrap_err();
        assert!(error.to_string().contains("contains a cycle"));
    }

    #[test]
    fn rejects_missing_relationship_columns() {
        let schema = LumiereSchemaManifest {
            version: 1,
            tables: vec![table("child", &["id"]), table("root", &["id"])],
            enum_types: vec![],
        };
        let storage = json!({"version":1,"policies":[
            {"table":"child","module":"test","durability_class":"durable_business_record","organization_ownership":"direct","organization_column":"organization_id","projection_mode":"upsert-current","aggregate":{"parent":{"table":"root","child_column":"root_id","parent_column":"id"}}},
            {"table":"root","module":"test","durability_class":"durable_business_record","organization_ownership":"direct","organization_column":"organization_id","projection_mode":"upsert-current","aggregate":{"parent":null}}
        ]});
        let error =
            emit_reconstruction_manifest(policy(), &schema, &storage, &durable(&["child", "root"]))
                .unwrap_err();
        assert!(error
            .to_string()
            .contains("lacks child relationship column"));
    }
}
