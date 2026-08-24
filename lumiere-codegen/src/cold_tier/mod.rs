//! Cold-tier schema pipeline: SpacetimeDB-generated Rust bindings → Lumiere
//! schema IR → archive manifest, PG DDL, codec manifest, hydration manifest.
//!
//! Steps run strictly in order because each later step consumes the schema
//! manifest (or the archive candidate list) produced/validated by an earlier
//! one:
//!
//! 1. `stdb_bindings_parse` — bindings → [`schema_ir::LumiereSchemaManifest`]
//! 2. `archive_manifest_emit` — validate `archive-candidates.json` against
//!    the schema manifest, emit `archive-manifest.json`
//! 3. `pg_ddl_emit` — one cold-table `CREATE TABLE` per active candidate
//! 4. `codec_emit` — STDB ↔ PG type-mapping manifest per candidate
//! 5. `hydration_manifest_emit` — reducers that may target archived rows
//!    (validated against the schema manifest + active candidate set)

pub mod archive_manifest_emit;
pub mod codec_emit;
pub mod hydration_manifest_emit;
pub mod pg_ddl_emit;
pub mod schema_ir;
pub mod stdb_bindings_parse;

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{Context, Result};
use schema_ir::LumiereSchemaManifest;
use serde_json::Value;

pub fn run(paths: &Paths) -> Result<()> {
    // ── 1. Schema IR: STDB Rust bindings → lumiere-schema-manifest.json ────

    let schema_manifest = stdb_bindings_parse::parse_bindings(&paths.stdb_bindings_dir)
        .context("extracting schema IR from STDB Rust bindings")?;
    let schema_manifest_json =
        serde_json::to_string_pretty(&schema_manifest).context("serialise schema manifest")?;
    write_file(&paths.schema_manifest_out, &schema_manifest_json)?;

    // ── 2. Archive manifest: validate candidates + emit archive-manifest.json

    let candidates_json = read_to_string(&paths.archive_candidates_json)?;
    let archive_manifest_json =
        archive_manifest_emit::emit_archive_manifest(&candidates_json, &schema_manifest)
            .context("generating archive manifest")?;
    write_file(&paths.archive_manifest_out, &archive_manifest_json)?;

    let candidates_value: Value = serde_json::from_str(&candidates_json)
        .context("re-parse archive-candidates.json for DDL step")?;
    let candidates_arr = candidates_value["candidates"]
        .as_array()
        .context("archive-candidates.json: 'candidates' must be an array")?;

    // ── 3. PG DDL: one SQL file per active archive candidate ───────────────

    let ddl_file_count = emit_ddl(paths, &schema_manifest, candidates_arr)?;

    // ── 4. Codec manifest: STDB ↔ PG type mapping per archive candidate ────

    let codec_manifest_json = codec_emit::emit_codec_manifest(&candidates_json, &schema_manifest)
        .context("generating codec manifest")?;
    write_file(&paths.codec_manifest_out, &codec_manifest_json)?;
    println!("Wrote {}", paths.codec_manifest_out.display());

    // ── 5. Hydration manifest: reducers that may target archived rows ──────

    let archive_tables: Vec<String> = candidates_arr
        .iter()
        .filter_map(|c| c["table"].as_str().map(String::from))
        .collect();
    let hydration_policies_json = read_to_string(&paths.hydration_policies_json)?;
    let hydration_manifest_json = hydration_manifest_emit::emit_hydration_manifest(
        &hydration_policies_json,
        &schema_manifest,
        &archive_tables,
    )
    .context("generating hydration manifest")?;
    write_file(&paths.hydration_manifest_out, &hydration_manifest_json)?;
    println!("Wrote {}", paths.hydration_manifest_out.display());

    println!(
        "lumiere-codegen: {} tables in schema IR ({} enum types) from {}",
        schema_manifest.tables.len(),
        schema_manifest.enum_types.len(),
        paths.stdb_bindings_dir.display()
    );
    println!("lumiere-codegen: {ddl_file_count} cold PG DDL file(s) from archive-candidates.json");
    println!("Wrote {}", paths.schema_manifest_out.display());
    println!("Wrote {}", paths.archive_manifest_out.display());

    Ok(())
}

fn emit_ddl(
    paths: &Paths,
    schema_manifest: &LumiereSchemaManifest,
    candidates_arr: &[Value],
) -> Result<usize> {
    let mut ddl_count = 0;
    for cand in candidates_arr {
        let table = cand["table"].as_str().unwrap_or_default();
        let cold_table = cand["cold_table"].as_str().unwrap_or_default();
        if table.is_empty() || cold_table.is_empty() {
            continue;
        }
        let cfg = pg_ddl_emit::ArchiveCandidateConfig { table, cold_table };
        let ddl = pg_ddl_emit::emit_cold_table_ddl(schema_manifest, &cfg)
            .with_context(|| format!("generating DDL for '{table}' → '{cold_table}'"))?;
        let ddl_path = paths.cold_ddl_dir.join(format!("{cold_table}.sql"));
        write_file(&ddl_path, &ddl)?;
        println!("Wrote {}", ddl_path.display());
        ddl_count += 1;
    }
    Ok(ddl_count)
}
