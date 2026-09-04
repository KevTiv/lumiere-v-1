//! Generates `realtime_wire.rs`: match arms to register row callbacks per STDB table
//! for resources listed in `crates/stdb-auth/assets/resource_registry.json`.

use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::Path;

const EXACT_COMPANY_CRM_TABLES: &[&str] = &[
    "contact",
    "opportunity",
    "opportunity_line",
    "opportunity_presence",
    "contact_phone_identity",
    "contact_role_assignment",
    "contact_communication_preference",
    "contact_tag_assignment",
    "segment_member",
    "privacy_consent",
    "contact_relationship_insight",
    "contact_relationship",
    "contact_duplicate_candidate",
    "crm_forecast_snapshot",
    "crm_conversation",
    "crm_conversation_message",
];

fn snake_to_pascal(table: &str) -> String {
    table
        .split('_')
        .map(|part| {
            let mut c = part.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().chain(c).collect(),
            }
        })
        .collect()
}

fn generate_contents(registry_path: &Path, bindings_dir: &Path) -> Result<String, String> {
    // Generated STDB bindings now live in the `lumiere-contracts` crate. This
    // build script still needs the raw per-table source text (not just the
    // compiled types) to detect `TableWithPrimaryKey` and `company_id`
    // column shape, so it reads the same gitignored staging checkout that
    // `lumiere-codegen` generates into. Populate it with
    // `make generate-stdb-rust-sdk` before building. See
    // docs/plans/contracts-extraction-execution-plan.md.
    let reg_raw = fs::read_to_string(registry_path)
        .map_err(|e| format!("read {}: {e}", registry_path.display()))?;
    let reg: serde_json::Value = serde_json::from_str(&reg_raw)
        .map_err(|e| format!("parse {}: {e}", registry_path.display()))?;

    let mut tables = BTreeSet::new();
    if let Some(obj) = reg.as_object() {
        for (_k, v) in obj {
            if let Some(t) = v.get("table").and_then(|x| x.as_str()) {
                tables.insert(t.to_string());
            }
        }
    }

    let mut arms = String::new();
    for table in tables.iter() {
        let table_mod = format!("{}_table", table);
        let pascal = snake_to_pascal(table);
        let trait_name = format!("{pascal}TableAccess");
        let table_file = bindings_dir.join(format!("{table_mod}.rs"));
        if !table_file.exists() {
            continue;
        }
        let tf = fs::read_to_string(&table_file)
            .map_err(|e| format!("read {}: {e}", table_file.display()))?;
        let row_type_file = bindings_dir.join(format!("{table}_type.rs"));
        let row_tf = fs::read_to_string(&row_type_file)
            .map_err(|e| format!("read {}: {e}", row_type_file.display()))?;
        let has_update = tf.contains("TableWithPrimaryKey");
        let company_filter = if row_tf.contains("pub company_id: Option<u64>")
            || row_tf.contains("pub company_id: Option::<u64>")
        {
            // CRM rows with an optional company column are exact-owned. `None`
            // is legacy/unscoped data and must never produce a company-scoped
            // browser invalidation.
            "company_id.map_or(true, |company_id| _row.company_id == Some(company_id))"
        } else if row_tf.contains("pub company_id: u64") {
            "company_id.map_or(true, |company_id| _row.company_id == company_id)"
        } else if EXACT_COMPANY_CRM_TABLES.contains(&table.as_str()) {
            panic!(
                "realtime exact-company table {table} has no company_id in generated row bindings"
            );
        } else {
            "true"
        };

        let method = table.replace('-', "_");
        let update_block = if has_update {
            format!(
                r#"
        c.db.{method}().on_update({{
            let r = r.clone();
            let tx = tx.clone();
            move |_ctx, _old, _row| {{
                if matches!(
                    &_ctx.event,
                    spacetimedb_sdk::Event::Transaction | spacetimedb_sdk::Event::Reducer(_)
                )
                    && {company_filter}
                {{
                    crate::realtime::notify_row_change(&tx, "update", "{table}", &r);
                }}
            }}
        }});"#,
                method = method,
                table = table,
                company_filter = company_filter,
            )
        } else {
            String::new()
        };

        let twpk = if has_update {
            "use spacetimedb_sdk::TableWithPrimaryKey;\n            "
        } else {
            ""
        };

        arms.push_str(&format!(
            r#"
        "{table}" => {{
            use lumiere_contracts::bindings::{table_mod}::{trait_name};
            use spacetimedb_sdk::Table;
            {twpk}let r = resources.to_vec();
            let tx = tx.clone();
            c.db.{method}().on_insert({{
                let r = r.clone();
                let tx = tx.clone();
                move |_ctx, _row| {{
                    if matches!(
                        &_ctx.event,
                        spacetimedb_sdk::Event::Transaction | spacetimedb_sdk::Event::Reducer(_)
                    )
                        && {company_filter}
                    {{
                        crate::realtime::notify_row_change(&tx, "insert", "{table}", &r);
                    }}
                }}
            }});
            c.db.{method}().on_delete({{
                let r = r.clone();
                let tx = tx.clone();
                move |_ctx, _row| {{
                    if matches!(
                        &_ctx.event,
                        spacetimedb_sdk::Event::Transaction | spacetimedb_sdk::Event::Reducer(_)
                    )
                        && {company_filter}
                    {{
                        crate::realtime::notify_row_change(&tx, "delete", "{table}", &r);
                    }}
                }}
            }});
            {update_block}
        }}"#,
            table = table,
            table_mod = table_mod,
            trait_name = trait_name,
            method = method,
            twpk = twpk,
            update_block = update_block,
            company_filter = company_filter,
        ));
    }

    Ok(format!(
        r#"// @generated by build.rs — do not edit
use lumiere_contracts::bindings::DbConnection;

/// Register insert/delete/(update) callbacks so any row change for `table` notifies the client.
pub(crate) fn wire_realtime_table_callbacks(
    c: &DbConnection,
    table: &str,
    resources: &[String],
    company_id: Option<u64>,
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {{
    match table {{
        {arms}
        _ => return Err(format!("realtime: no wire for table {{}}", table)),
    }}
    Ok(())
}}
"#,
        arms = arms
    ))
}

fn write_if_changed(path: &Path, contents: &[u8]) -> Result<(), String> {
    let unchanged = fs::read(path)
        .map(|existing| existing == contents)
        .unwrap_or(false);
    if !unchanged {
        fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))?;
    }
    Ok(())
}

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let registry_path =
        Path::new(&manifest_dir).join("../crates/stdb-auth/assets/resource_registry.json");
    let staging_dir =
        env::var("CONTRACTS_STAGING_DIR").unwrap_or_else(|_| "../.contracts-staging".to_string());
    let bindings_dir = Path::new(&manifest_dir).join(staging_dir).join("bindings");
    if !bindings_dir.is_dir() {
        panic!(
            "missing generated STDB bindings at {} — run `make generate-stdb-rust-sdk` first",
            bindings_dir.display()
        );
    }

    let contents =
        generate_contents(&registry_path, &bindings_dir).unwrap_or_else(|e| panic!("{e}"));
    let out_dir = env::var("OUT_DIR").expect("OUT_DIR");
    let out_path = Path::new(&out_dir).join("realtime_wire.rs");

    write_if_changed(&out_path, contents.as_bytes()).unwrap_or_else(|e| panic!("{e}"));
    println!("cargo:rerun-if-changed={}", registry_path.display());
    // Cargo recursively watches directory inputs, including added bindings.
    println!("cargo:rerun-if-changed={}", bindings_dir.display());
    println!("cargo:rerun-if-env-changed=CONTRACTS_STAGING_DIR");
    println!("cargo:rerun-if-changed=build.rs");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn generation_is_deterministic_and_unchanged_output_is_not_rewritten() {
        let root = env::temp_dir().join(format!(
            "lumiere-build-rs-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bindings = root.join("bindings");
        fs::create_dir_all(&bindings).unwrap();
        fs::write(
            root.join("registry.json"),
            r#"{"z":{"table":"zeta"},"a":{"table":"alpha"}}"#,
        )
        .unwrap();
        for table in ["alpha", "zeta"] {
            fs::write(
                bindings.join(format!("{table}_table.rs")),
                "pub trait AlphaTableAccess {}",
            )
            .unwrap();
            fs::write(
                bindings.join(format!("{table}_type.rs")),
                "pub company_id: u64",
            )
            .unwrap();
        }
        let first = generate_contents(&root.join("registry.json"), &bindings).unwrap();
        let second = generate_contents(&root.join("registry.json"), &bindings).unwrap();
        assert_eq!(first, second);
        assert!(first.find("\"alpha\"").unwrap() < first.find("\"zeta\"").unwrap());
        let output = root.join("out.rs");
        write_if_changed(&output, first.as_bytes()).unwrap();
        let before = fs::metadata(&output).unwrap().modified().unwrap();
        write_if_changed(&output, second.as_bytes()).unwrap();
        assert_eq!(before, fs::metadata(&output).unwrap().modified().unwrap());
        write_if_changed(&output, b"changed").unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"changed");
        fs::remove_file(bindings.join("zeta_type.rs")).unwrap();
        let error = generate_contents(&root.join("registry.json"), &bindings).unwrap_err();
        assert!(error.contains("zeta_type.rs"));
        let _ = fs::remove_dir_all(root);
    }
}
