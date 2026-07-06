//! Loads canonical registries from `stdb-auth` and emits TypeScript for the frontend.
//!
//! ```text
//! cargo run -p lumiere-codegen
//! API_CODEGEN_REGISTRY_OUT=frontend/packages/stdb/src/generated/query-registry.ts cargo run -p lumiere-codegen
//! API_CODEGEN_STDB_INVALIDATION_OUT=frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts
//! ```

mod erp_org_sql_emit;
mod registry_emit;
mod sql_columns_emit;
mod stdb_invalidation_emit;

use anyhow::{Context, Result};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn write_file(path: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    fs::write(path, contents).with_context(|| format!("write {}", path.display()))
}

fn sync_asset(manifest_dir: &Path, asset_name: &str, frontend_rel: &str) -> Result<PathBuf> {
    let src = manifest_dir.join("../crates/stdb-auth/assets").join(asset_name);
    let text = fs::read_to_string(&src).with_context(|| format!("read {}", src.display()))?;
    let out = manifest_dir.join("../").join(frontend_rel);
    write_file(&out, &text)?;
    Ok(out)
}

fn main() -> Result<()> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let registry_path = manifest_dir.join("../crates/stdb-auth/assets/resource_registry.json");
    let registry_text = fs::read_to_string(&registry_path)
        .with_context(|| format!("read {}", registry_path.display()))?;

    let registry_out = env_or_default(
        "API_CODEGEN_REGISTRY_OUT",
        "frontend/packages/stdb/src/generated/query-registry.ts",
    );
    let registry_path_out = Path::new(&registry_out);
    let registry_ts = registry_emit::emit_query_registry_typescript(&registry_text)?;
    write_file(registry_path_out, &registry_ts)?;

    let invalidation_manifest = manifest_dir.join("reducer-stdb-invalidation.json");
    let stdb_inv_out = env_or_default(
        "API_CODEGEN_STDB_INVALIDATION_OUT",
        "frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts",
    );
    let stdb_inv_path = Path::new(&stdb_inv_out);
    let manifest_text = fs::read_to_string(&invalidation_manifest)
        .with_context(|| format!("read {}", invalidation_manifest.display()))?;
    let manifest: Value = serde_json::from_str(&manifest_text)
        .with_context(|| format!("parse {}", invalidation_manifest.display()))?;
    let stdb_inv_ts = stdb_invalidation_emit::emit_std_invalidation_typescript(&manifest)?;
    write_file(stdb_inv_path, &stdb_inv_ts)?;

    let types_ts_path = manifest_dir.join("../frontend/packages/stdb/src/generated/types.ts");
    let types_ts = fs::read_to_string(&types_ts_path)
        .with_context(|| format!("read {}", types_ts_path.display()))?;
    let generated_dir = manifest_dir.join("../frontend/packages/stdb/src/generated");
    let sql_columns_json =
        sql_columns_emit::emit_sql_columns_json(&types_ts, &generated_dir)?;
    let sql_columns_frontend =
        manifest_dir.join("../frontend/packages/stdb/src/stdb-generated-sql-columns.json");
    let sql_columns_rust =
        manifest_dir.join("../crates/stdb-auth/assets/stdb-generated-sql-columns.json");
    write_file(&sql_columns_frontend, &sql_columns_json)?;
    write_file(&sql_columns_rust, &sql_columns_json)?;

    let row_type_out = sync_asset(
        manifest_dir,
        "query-resource-row-type.json",
        "frontend/packages/stdb/src/query-resource-row-type.json",
    )?;

    let erp_subs_path =
        manifest_dir.join("../frontend/packages/stdb/src/queries/erp-subscriptions.ts");
    let erp_subs_ts = fs::read_to_string(&erp_subs_path)
        .with_context(|| format!("read {}", erp_subs_path.display()))?;
    let erp_org_rows = erp_org_sql_emit::parse_erp_org_sql(&erp_subs_ts)?;
    let registry_keys = erp_org_sql_emit::registry_keys(&registry_text)
        .map_err(|e| anyhow::anyhow!(e))?;
    for row in &erp_org_rows {
        if !registry_keys.contains_key(&row.resource_key) {
            anyhow::bail!(
                "erp-org-sql resource \"{}\" (map key \"{}\") missing from resource_registry.json",
                row.resource_key,
                row.map_key
            );
        }
    }
    let erp_org_json = erp_org_sql_emit::emit_erp_org_sql_json(&erp_subs_ts)?;
    let erp_org_rust =
        manifest_dir.join("../crates/stdb-auth/assets/erp-org-sql.json");
    write_file(&erp_org_rust, &erp_org_json)?;

    let key_count = serde_json::from_str::<Value>(&registry_text)?
        .as_object()
        .map(|o| o.len())
        .unwrap_or(0);
    let type_count = serde_json::from_str::<Value>(&sql_columns_json)?
        .as_object()
        .map(|o| o.len())
        .unwrap_or(0);

    println!(
        "lumiere-codegen: {key_count} registry keys from {}",
        registry_path.display()
    );
    println!("lumiere-codegen: {type_count} SQL column maps from {}", types_ts_path.display());
    println!("lumiere-codegen: {} ERP org subscription rows from {}", erp_org_rows.len(), erp_subs_path.display());
    println!("Wrote {}", registry_path_out.display());
    println!("Wrote {}", stdb_inv_path.display());
    println!("Wrote {}", sql_columns_frontend.display());
    println!("Wrote {}", sql_columns_rust.display());
    println!("Wrote {}", row_type_out.display());
    println!("Wrote {}", erp_org_rust.display());
    Ok(())
}
