//! Loads canonical registries from `stdb-auth` and emits TypeScript for the frontend,
//! plus the Lumiere schema IR and cold-tier artifacts from SpacetimeDB-generated Rust bindings.
//!
//! ```text
//! cargo run -p lumiere-codegen
//! API_CODEGEN_REGISTRY_OUT=frontend/packages/stdb/src/generated/query-registry.ts cargo run -p lumiere-codegen
//! API_CODEGEN_STDB_INVALIDATION_OUT=frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts
//! ```

mod archive_manifest_emit;
mod codec_emit;
mod erp_org_sql_emit;
mod hydration_manifest_emit;
mod pg_ddl_emit;
mod query_exec_audit;
mod registry_emit;
mod schema_ir;
mod sql_columns_emit;
mod stdb_bindings_parse;
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
    let src = manifest_dir
        .join("../crates/stdb-auth/assets")
        .join(asset_name);
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
    let sql_columns_json = sql_columns_emit::emit_sql_columns_json(&types_ts, &generated_dir)?;
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
    let registry_keys =
        erp_org_sql_emit::registry_keys(&registry_text).map_err(|e| anyhow::anyhow!(e))?;
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
    let erp_org_rust = manifest_dir.join("../crates/stdb-auth/assets/erp-org-sql.json");
    write_file(&erp_org_rust, &erp_org_json)?;

    let allowlist_path =
        manifest_dir.join("../crates/stdb-auth/assets/query_exec_non_registry.json");
    let allowlist_json = fs::read_to_string(&allowlist_path)
        .with_context(|| format!("read {}", allowlist_path.display()))?;
    let query_exec_path = manifest_dir.join("../api-server/src/query_exec.rs");
    let query_exec_rs = fs::read_to_string(&query_exec_path)
        .with_context(|| format!("read {}", query_exec_path.display()))?;
    query_exec_audit::audit_query_exec_special_cases(
        &query_exec_rs,
        &registry_text,
        &allowlist_json,
    )?;

    // ── 2. Schema IR: STDB Rust bindings → lumiere-schema-manifest.json ─────

    let bindings_dir = manifest_dir.join("../api-server/src/stdb_sdk_bindings");
    let schema_manifest = stdb_bindings_parse::parse_bindings(&bindings_dir)
        .context("extracting schema IR from STDB Rust bindings")?;

    let schema_manifest_json =
        serde_json::to_string_pretty(&schema_manifest).context("serialise schema manifest")?;
    let schema_manifest_path =
        manifest_dir.join("../crates/stdb-auth/assets/lumiere-schema-manifest.json");
    write_file(&schema_manifest_path, &schema_manifest_json)?;

    // ── 3. Archive manifest: validate candidates + emit archive-manifest.json ─

    let candidates_path = manifest_dir.join("archive-candidates.json");
    let candidates_json = fs::read_to_string(&candidates_path)
        .with_context(|| format!("read {}", candidates_path.display()))?;

    let archive_manifest_json =
        archive_manifest_emit::emit_archive_manifest(&candidates_json, &schema_manifest)
            .context("generating archive manifest")?;
    let archive_manifest_path =
        manifest_dir.join("../crates/stdb-auth/assets/archive-manifest.json");
    write_file(&archive_manifest_path, &archive_manifest_json)?;

    // ── 4. PG DDL: one SQL file per active archive candidate ─────────────────

    let candidates_value: Value = serde_json::from_str(&candidates_json)
        .context("re-parse archive-candidates.json for DDL step")?;
    let candidates_arr = candidates_value["candidates"]
        .as_array()
        .context("archive-candidates.json: 'candidates' must be an array")?;

    let mut ddl_count = 0;
    for cand in candidates_arr {
        let table = cand["table"].as_str().unwrap_or_default();
        let cold_table = cand["cold_table"].as_str().unwrap_or_default();
        if table.is_empty() || cold_table.is_empty() {
            continue;
        }
        let cfg = pg_ddl_emit::ArchiveCandidateConfig { table, cold_table };
        let ddl = pg_ddl_emit::emit_cold_table_ddl(&schema_manifest, &cfg)
            .with_context(|| format!("generating DDL for '{table}' → '{cold_table}'"))?;
        let ddl_path = manifest_dir
            .join("../api-server/src/generated/pg_ddl")
            .join(format!("{cold_table}.sql"));
        write_file(&ddl_path, &ddl)?;
        println!("Wrote {}", ddl_path.display());
        ddl_count += 1;
    }

    // ── 5. Codec manifest: STDB ↔ PG type mapping per archive candidate ──────

    let codec_manifest_json = codec_emit::emit_codec_manifest(&candidates_json, &schema_manifest)
        .context("generating codec manifest")?;
    let codec_manifest_path = manifest_dir.join("../crates/stdb-auth/assets/codec-manifest.json");
    write_file(&codec_manifest_path, &codec_manifest_json)?;
    println!("Wrote {}", codec_manifest_path.display());

    // ── 6. Hydration manifest: reducers that may target archived rows ────────
    //
    // The policy list is driven by `hydration-policies.json` (empty for Phase 1
    // since audit_log is append-only and immutable).  Each policy is validated
    // against the schema manifest and the active archive-candidate table set.

    let archive_tables: Vec<String> = candidates_arr
        .iter()
        .filter_map(|c| c["table"].as_str().map(String::from))
        .collect();

    let hydration_policies_path = manifest_dir.join("hydration-policies.json");
    let hydration_policies_json = fs::read_to_string(&hydration_policies_path)
        .with_context(|| format!("read {}", hydration_policies_path.display()))?;

    let hydration_manifest_json = hydration_manifest_emit::emit_hydration_manifest(
        &hydration_policies_json,
        &schema_manifest,
        &archive_tables,
    )
    .context("generating hydration manifest")?;
    let hydration_manifest_path =
        manifest_dir.join("../crates/stdb-auth/assets/hydration-manifest.json");
    write_file(&hydration_manifest_path, &hydration_manifest_json)?;
    println!("Wrote {}", hydration_manifest_path.display());

    // ── 7. Summary ────────────────────────────────────────────────────────────

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
    println!(
        "lumiere-codegen: {type_count} SQL column maps from {}",
        types_ts_path.display()
    );
    println!(
        "lumiere-codegen: {} ERP org subscription rows from {}",
        erp_org_rows.len(),
        erp_subs_path.display()
    );
    println!(
        "lumiere-codegen: {} tables in schema IR ({} enum types) from {}",
        schema_manifest.tables.len(),
        schema_manifest.enum_types.len(),
        bindings_dir.display()
    );
    println!("lumiere-codegen: {ddl_count} cold PG DDL file(s) from archive-candidates.json");
    println!("Wrote {}", registry_path_out.display());
    println!("Wrote {}", stdb_inv_path.display());
    println!("Wrote {}", sql_columns_frontend.display());
    println!("Wrote {}", sql_columns_rust.display());
    println!("Wrote {}", row_type_out.display());
    println!("Wrote {}", erp_org_rust.display());
    println!("Wrote {}", schema_manifest_path.display());
    println!("Wrote {}", archive_manifest_path.display());
    Ok(())
}
