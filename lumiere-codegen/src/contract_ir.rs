//! Canonical, versioned IR exported for target-specific contract emitters.
//!
//! This is the repository boundary: Rust/STDB source is interpreted here.
//! Consumers receive a complete immutable JSON document and must not inspect
//! or clone mutable `lumiere-v-1` source while generating packages.

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::process::Command;

const IR_VERSION: u32 = 1;
const IR_FILENAME: &str = "lumiere-contract-ir-v1.json";

#[derive(Debug, Serialize)]
struct ContractIr {
    ir_version: u32,
    source_commit: String,
    source_dirty: bool,
    schema_hash: String,
    operations: Vec<Value>,
    resources: Vec<NamedContract>,
    tables: Vec<Value>,
    types: Vec<IndexedType>,
}

#[derive(Debug, Serialize)]
struct SemanticContract<'a> {
    operations: &'a [Value],
    resources: &'a [NamedContract],
    tables: &'a [Value],
    types: &'a [IndexedType],
}

#[derive(Debug, Serialize)]
struct NamedContract {
    name: String,
    contract: Value,
}

#[derive(Debug, Serialize)]
struct IndexedType {
    index: usize,
    names: Vec<String>,
    definition: Value,
}

pub fn run(paths: &Paths, registry_text: &str) -> Result<()> {
    let module_schema: Value = serde_json::from_str(&read_to_string(&paths.module_schema_json)?)
        .with_context(|| format!("parse {}", paths.module_schema_json.display()))?;
    let reducer_manifest: Value =
        serde_json::from_str(&read_to_string(&paths.reducer_manifest_out)?)
            .with_context(|| format!("parse {}", paths.reducer_manifest_out.display()))?;

    let resources = parse_resources(registry_text)?;
    let resource_names = resources
        .iter()
        .map(|resource| resource.name.as_str())
        .collect();
    let invalidations = parse_invalidations(paths, &resource_names)?;
    let operations = merge_operations(&module_schema, &reducer_manifest, invalidations)?;
    let tables = sorted_values(&module_schema, "tables", table_sort_key)?;
    let types = indexed_types(&module_schema)?;
    let semantic = SemanticContract {
        operations: &operations,
        resources: &resources,
        tables: &tables,
        types: &types,
    };
    let schema_hash = prefixed_sha256(&serde_json::to_vec(&semantic)?);
    let (source_commit, source_dirty) = source_provenance()?;
    let ir = ContractIr {
        ir_version: IR_VERSION,
        source_commit,
        source_dirty,
        schema_hash,
        operations,
        resources,
        tables,
        types,
    };

    let json = serde_json::to_string_pretty(&ir)? + "\n";
    let artifact_hash = hex::encode(Sha256::digest(json.as_bytes()));
    write_file(&paths.contract_ir_out, &json)?;
    write_file(
        &paths.contract_ir_checksum_out,
        &format!("{artifact_hash}  {IR_FILENAME}\n"),
    )?;
    println!("Wrote {}", paths.contract_ir_out.display());
    println!("Wrote {}", paths.contract_ir_checksum_out.display());
    Ok(())
}

fn merge_operations(
    module_schema: &Value,
    reducer_manifest: &Value,
    mut invalidations: BTreeMap<String, Vec<String>>,
) -> Result<Vec<Value>> {
    let raw_reducers = module_schema
        .get("reducers")
        .and_then(Value::as_array)
        .context("module schema reducers must be an array")?;
    let contracts = reducer_manifest
        .get("reducers")
        .and_then(Value::as_array)
        .context("reducer manifest reducers must be an array")?;
    let mut raw_by_name = BTreeMap::new();
    for reducer in raw_reducers {
        let name = value_name(reducer, "reducer")?;
        if raw_by_name
            .insert(name.to_owned(), reducer.clone())
            .is_some()
        {
            bail!("duplicate module reducer {name}");
        }
    }

    let mut operations = Vec::with_capacity(contracts.len());
    for contract in contracts {
        let name = value_name(contract, "reducer contract")?;
        let schema = raw_by_name
            .remove(name)
            .with_context(|| format!("reducer contract {name} has no module schema entry"))?;
        let invalidates = invalidations.remove(name).unwrap_or_default();
        operations.push(serde_json::json!({
            "name": name,
            "kind": "reducer",
            "application": contract,
            "invalidates": invalidates,
            "schema": schema,
        }));
    }
    if !raw_by_name.is_empty() {
        bail!(
            "module reducers missing contracts: {}",
            raw_by_name.keys().cloned().collect::<Vec<_>>().join(", ")
        );
    }
    append_misc_operations(module_schema, &mut operations, &mut invalidations)?;
    if !invalidations.is_empty() {
        bail!(
            "invalidation metadata names missing operations: {}",
            invalidations.keys().cloned().collect::<Vec<_>>().join(", ")
        );
    }
    operations.sort_by(|left, right| operation_name(left).cmp(operation_name(right)));
    Ok(operations)
}

fn append_misc_operations(
    module_schema: &Value,
    operations: &mut Vec<Value>,
    invalidations: &mut BTreeMap<String, Vec<String>>,
) -> Result<()> {
    let mut names = operations
        .iter()
        .map(|operation| operation_name(operation).to_owned())
        .collect::<std::collections::BTreeSet<_>>();
    for export in module_schema
        .get("misc_exports")
        .and_then(Value::as_array)
        .context("module schema misc_exports must be an array")?
    {
        let Some((variant, schema)) = export
            .as_object()
            .and_then(|object| (object.len() == 1).then(|| object.iter().next()).flatten())
        else {
            bail!("module schema misc export must have exactly one variant");
        };
        let kind = match variant.as_str() {
            "Procedure" => "procedure",
            "View" => "view",
            _ => continue,
        };
        let name = value_name(schema, kind)?;
        if !names.insert(name.to_owned()) {
            bail!("duplicate module operation {name}");
        }
        operations.push(serde_json::json!({
            "name": name,
            "kind": kind,
            "application": null,
            "invalidates": invalidations.remove(name).unwrap_or_default(),
            "schema": schema,
        }));
    }
    Ok(())
}

fn parse_invalidations(
    paths: &Paths,
    resource_names: &std::collections::BTreeSet<&str>,
) -> Result<BTreeMap<String, Vec<String>>> {
    let mut invalidations: BTreeMap<String, Vec<String>> =
        serde_json::from_str(&read_to_string(&paths.reducer_stdb_invalidation_json)?)
            .with_context(|| format!("parse {}", paths.reducer_stdb_invalidation_json.display()))?;
    for (operation, resources) in &mut invalidations {
        resources.sort();
        if resources.windows(2).any(|pair| pair[0] == pair[1]) {
            bail!("operation {operation} contains a duplicate invalidated resource");
        }
        for resource in resources {
            if !resource_names.contains(resource.as_str()) {
                bail!("operation {operation} invalidates unknown resource {resource}");
            }
        }
    }
    Ok(invalidations)
}

fn parse_resources(registry_text: &str) -> Result<Vec<NamedContract>> {
    let registry: BTreeMap<String, Value> =
        serde_json::from_str(registry_text).context("parse resource registry")?;
    Ok(registry
        .into_iter()
        .map(|(name, contract)| NamedContract { name, contract })
        .collect())
}

fn indexed_types(module_schema: &Value) -> Result<Vec<IndexedType>> {
    let definitions = module_schema
        .pointer("/typespace/types")
        .and_then(Value::as_array)
        .context("module schema typespace.types must be an array")?;
    let mut names_by_index: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for named_type in module_schema
        .get("types")
        .and_then(Value::as_array)
        .context("module schema types must be an array")?
    {
        let index = named_type
            .get("ty")
            .and_then(Value::as_u64)
            .context("named module type has no numeric ty")? as usize;
        if index >= definitions.len() {
            bail!("named module type references missing typespace index {index}");
        }
        let name = named_type
            .pointer("/name/name")
            .and_then(Value::as_str)
            .context("named module type has no name.name")?;
        names_by_index
            .entry(index)
            .or_default()
            .push(name.to_owned());
    }

    Ok(definitions
        .iter()
        .enumerate()
        .map(|(index, definition)| {
            let mut names = names_by_index.remove(&index).unwrap_or_default();
            names.sort();
            IndexedType {
                index,
                names,
                definition: definition.clone(),
            }
        })
        .collect())
}

fn sorted_values(root: &Value, field: &str, key: fn(&Value) -> &str) -> Result<Vec<Value>> {
    let mut values = root
        .get(field)
        .and_then(Value::as_array)
        .with_context(|| format!("module schema {field} must be an array"))?
        .clone();
    values.sort_by(|left, right| key(left).cmp(key(right)));
    Ok(values)
}

fn table_sort_key(value: &Value) -> &str {
    value.get("name").and_then(Value::as_str).unwrap_or("")
}

fn operation_name(value: &Value) -> &str {
    value.get("name").and_then(Value::as_str).unwrap_or("")
}

fn value_name<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    value
        .get("name")
        .and_then(Value::as_str)
        .with_context(|| format!("{label} has no name"))
}

fn prefixed_sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn source_provenance() -> Result<(String, bool)> {
    if let Ok(commit) = std::env::var("LUMIERE_SOURCE_COMMIT") {
        let commit = commit.trim();
        if !is_git_object_id(commit) {
            bail!("LUMIERE_SOURCE_COMMIT must be a 40- or 64-character lowercase hex object ID");
        }
        let dirty = std::env::var("LUMIERE_SOURCE_DIRTY").is_ok_and(|value| value == "1");
        return Ok((commit.to_owned(), dirty));
    }

    let commit = git_output(&["rev-parse", "HEAD"])?;
    if !is_git_object_id(&commit) {
        bail!("git rev-parse returned an invalid object ID: {commit}");
    }
    let status = git_output(&[
        "status",
        "--porcelain",
        "--untracked-files=normal",
        "--",
        "spacetimedb",
        "lumiere-codegen",
        "crates/stdb-auth/assets/resource_registry.json",
    ])?;
    Ok((commit, !status.is_empty()))
}

fn is_git_object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn git_output(args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .with_context(|| format!("run git {}", args.join(" ")))?;
    if !output.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8(output.stdout)
        .context("git output was not UTF-8")?
        .trim()
        .to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_hash_ignores_provenance() {
        let resources = vec![NamedContract {
            name: "orders".to_owned(),
            contract: serde_json::json!({"table": "sale_order"}),
        }];
        let semantic = SemanticContract {
            operations: &[],
            resources: &resources,
            tables: &[],
            types: &[],
        };
        let first = prefixed_sha256(&serde_json::to_vec(&semantic).unwrap());
        let second = prefixed_sha256(&serde_json::to_vec(&semantic).unwrap());
        assert_eq!(first, second);
    }

    #[test]
    fn rejects_operation_sets_that_do_not_match() {
        let schema = serde_json::json!({"reducers": [{"name": "create_order"}]});
        let manifest = serde_json::json!({"reducers": [{"name": "cancel_order"}]});
        assert!(merge_operations(&schema, &manifest, BTreeMap::new()).is_err());
    }

    #[test]
    fn retains_unnamed_typespace_entries() {
        let schema = serde_json::json!({
            "types": [{"name": {"name": "Order"}, "ty": 1}],
            "typespace": {"types": [{"U64": []}, {"Product": {"elements": []}}]}
        });
        let types = indexed_types(&schema).unwrap();
        assert_eq!(types.len(), 2);
        assert!(types[0].names.is_empty());
        assert_eq!(types[1].names, ["Order"]);
    }

    #[test]
    fn includes_v9_procedures_as_unannotated_operations() {
        let schema = serde_json::json!({
            "reducers": [],
            "misc_exports": [{
                "Procedure": {"name": "fetch_exchange_rate", "params": {"elements": []}}
            }]
        });
        let manifest = serde_json::json!({"reducers": []});
        let operations = merge_operations(&schema, &manifest, BTreeMap::new()).unwrap();
        assert_eq!(operations[0]["kind"], "procedure");
        assert!(operations[0]["application"].is_null());
    }
}
