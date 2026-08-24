//! Frontend registry pipeline: `resource_registry.json` + STDB-generated
//! `types.ts` → TypeScript query registry, reducer-invalidation table, and
//! SQL-column maps consumed by the frontend and by `stdb-auth`.

mod registry_emit;
mod sql_columns_emit;
mod stdb_invalidation_emit;

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{Context, Result};
use serde_json::Value;

pub fn run(paths: &Paths, registry_text: &str) -> Result<()> {
    let registry_ts = registry_emit::emit_query_registry_typescript(registry_text)?;
    write_file(&paths.query_registry_ts_out, &registry_ts)?;

    let manifest_text = read_to_string(&paths.reducer_stdb_invalidation_json)?;
    let manifest: Value = serde_json::from_str(&manifest_text)
        .with_context(|| format!("parse {}", paths.reducer_stdb_invalidation_json.display()))?;
    let stdb_inv_ts = stdb_invalidation_emit::emit_std_invalidation_typescript(&manifest)?;
    write_file(&paths.stdb_invalidation_ts_out, &stdb_inv_ts)?;

    let types_ts = read_to_string(&paths.types_ts)?;
    let sql_columns_json =
        sql_columns_emit::emit_sql_columns_json(&types_ts, &paths.stdb_generated_dir)?;
    write_file(&paths.sql_columns_frontend_out, &sql_columns_json)?;
    write_file(&paths.sql_columns_rust_out, &sql_columns_json)?;

    let row_type_json = read_to_string(&paths.query_resource_row_type_asset)?;
    write_file(&paths.query_resource_row_type_out, &row_type_json)?;

    let registry_key_count = serde_json::from_str::<Value>(registry_text)?
        .as_object()
        .map(|o| o.len())
        .unwrap_or(0);
    let sql_column_type_count = serde_json::from_str::<Value>(&sql_columns_json)?
        .as_object()
        .map(|o| o.len())
        .unwrap_or(0);

    println!(
        "lumiere-codegen: {registry_key_count} registry keys from {}",
        paths.resource_registry_json.display()
    );
    println!(
        "lumiere-codegen: {sql_column_type_count} SQL column maps from {}",
        paths.types_ts.display()
    );
    println!("Wrote {}", paths.query_registry_ts_out.display());
    println!("Wrote {}", paths.stdb_invalidation_ts_out.display());
    println!("Wrote {}", paths.sql_columns_frontend_out.display());
    println!("Wrote {}", paths.sql_columns_rust_out.display());
    println!("Wrote {}", paths.query_resource_row_type_out.display());

    Ok(())
}
