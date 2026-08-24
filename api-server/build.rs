//! Generates `realtime_wire.rs`: match arms to register row callbacks per STDB table
//! for resources listed in `crates/stdb-auth/assets/resource_registry.json`.

use std::collections::HashSet;
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

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let registry_path =
        Path::new(&manifest_dir).join("../crates/stdb-auth/assets/resource_registry.json");
    // Generated STDB bindings now live in the `lumiere-contracts` crate. This
    // build script still needs the raw per-table source text (not just the
    // compiled types) to detect `TableWithPrimaryKey` and `company_id`
    // column shape, so it reads the same gitignored staging checkout that
    // `lumiere-codegen` generates into. Populate it with
    // `make generate-stdb-rust-sdk` before building. See
    // docs/plans/contracts-extraction-execution-plan.md.
    let staging_dir = env::var("CONTRACTS_STAGING_DIR")
        .unwrap_or_else(|_| "../.contracts-staging".to_string());
    let bindings_dir = Path::new(&manifest_dir).join(staging_dir).join("bindings");
    if !bindings_dir.is_dir() {
        panic!(
            "missing generated STDB bindings at {} — run `make generate-stdb-rust-sdk` first",
            bindings_dir.display()
        );
    }

    let reg_raw = fs::read_to_string(&registry_path).unwrap_or_else(|e| {
        panic!(
            "read resource_registry.json: {e} (path {})",
            registry_path.display()
        );
    });
    let reg: serde_json::Value =
        serde_json::from_str(&reg_raw).expect("parse resource_registry.json");

    let mut tables: HashSet<String> = HashSet::new();
    if let Some(obj) = reg.as_object() {
        for (_k, v) in obj {
            if let Some(t) = v.get("table").and_then(|x| x.as_str()) {
                tables.insert(t.to_string());
            }
        }
    }

    let out_dir = env::var("OUT_DIR").expect("OUT_DIR");
    let out_path = Path::new(&out_dir).join("realtime_wire.rs");

    let mut arms = String::new();
    for table in tables.iter() {
        let table_mod = format!("{}_table", table);
        let pascal = snake_to_pascal(table);
        let trait_name = format!("{pascal}TableAccess");
        let table_file = bindings_dir.join(format!("{table_mod}.rs"));
        if !table_file.exists() {
            continue;
        }
        let tf = fs::read_to_string(&table_file).unwrap_or_default();
        let row_type_file = bindings_dir.join(format!("{table}_type.rs"));
        let row_tf = fs::read_to_string(row_type_file).unwrap_or_default();
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

    let contents = format!(
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
    );

    fs::write(&out_path, contents).unwrap_or_else(|e| panic!("write {}: {e}", out_path.display()));
    println!("cargo:rerun-if-changed={}", registry_path.display());
    println!("cargo:rerun-if-changed={}", bindings_dir.display());
    println!("cargo:rerun-if-changed=build.rs");
}
