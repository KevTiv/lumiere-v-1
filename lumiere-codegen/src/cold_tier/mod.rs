//! Cold-tier schema pipeline: SpacetimeDB-generated Rust bindings → Lumiere
//! schema IR → total storage policy, archive manifest, PG DDL, codec manifest,
//! hydration and reconstruction manifests.
//!
//! Steps run strictly in order because each later step consumes the schema
//! manifest or the total storage-policy census produced/validated by an
//! earlier one:
//!
//! 1. `stdb_bindings_parse` — bindings → [`schema_ir::LumiereSchemaManifest`]
//! 2. `storage_policy_manifest_emit` — validate the C1 all-table census
//! 3. `archive_manifest_emit` — generate the cooling-eligible archive subset
//!    from the storage-policy census and validate it against the schema IR
//! 4. `pg_ddl_emit` — one cold-table `CREATE TABLE` per active candidate
//! 5. `codec_emit` — STDB ↔ PG type-mapping manifests for archive candidates
//!    and all projection tables
//! 6. `hydration_manifest_emit` — reducers that may target archived rows
//!    (validated against the schema manifest + active candidate set)
//! 7. `reconstruction_manifest_emit` — reviewed aggregate relationships and
//!    deterministic parent-before-child organization restore order

pub mod archive_manifest_emit;
pub mod codec_emit;
pub mod hydration_manifest_emit;
pub mod pg_ddl_emit;
pub mod pg_migration_emit;
pub mod reconstruction_apply_emit;
pub mod reconstruction_manifest_emit;
pub mod schema_ir;
pub mod stdb_bindings_parse;
pub mod storage_policy_manifest_emit;

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{Context, Result};
use schema_ir::{LumiereSchemaManifest, OwnershipCounts};
use serde_json::Value;

/// Fast path for regenerating the closed STDB apply dispatch from an already
/// generated canonical contracts manifest.
pub fn run_reconstruction_apply(paths: &Paths) -> Result<()> {
    let manifest_json = read_to_string(&paths.reconstruction_manifest_out)?;
    let generated = reconstruction_apply_emit::emit_reconstruction_apply(
        &manifest_json,
        &paths.spacetimedb_src_dir,
    )
    .context("generating closed SpacetimeDB reconstruction apply dispatch")?;
    write_file(&paths.reconstruction_apply_rust_out, &generated)?;
    println!("Wrote {}", paths.reconstruction_apply_rust_out.display());
    Ok(())
}

pub fn run(paths: &Paths) -> Result<()> {
    // ── 1. Schema IR: STDB Rust bindings → lumiere-schema-manifest.json ────

    let schema_manifest = stdb_bindings_parse::parse_bindings(&paths.stdb_bindings_dir)
        .context("extracting schema IR from STDB Rust bindings")?;
    let c0_enforced = std::env::var("C0_ENFORCE_TENANT_OWNERSHIP").as_deref() == Ok("1");
    let ownership_counts: Option<OwnershipCounts> = match schema_manifest.ownership_counts() {
        Ok(counts) => Some(counts),
        Err(error) if !c0_enforced => {
            eprintln!(
                "lumiere-codegen: warning: C0 ownership gate disabled; {}",
                error
            );
            None
        }
        Err(error) => return Err(error).context("classifying schema table ownership"),
    };
    if c0_enforced {
        schema_manifest
            .validate_tenant_ownership()
            .context("validating C0 organization ownership")?;
    }
    let mut schema_manifest_value =
        serde_json::to_value(&schema_manifest).context("serialise schema manifest")?;
    schema_manifest_value["ownership_summary"] = match ownership_counts {
        Some(counts) => serde_json::json!({
            "verified": true,
            "erp_owned_count": counts.erp_owned_count,
            "application_relation_count": schema_manifest.tables.iter()
                .filter(|table| !matches!(table.sql_name.as_str(),
                    "organization_commit" | "organization_commit_cursor"
                    | "organization_reconstruction_batch_receipt"
                    | "organization_reconstruction_fence" | "organization_row_change"))
                .count(),
            "protocol_relation_count": schema_manifest.tables.iter()
                .filter(|table| matches!(table.sql_name.as_str(),
                    "organization_commit" | "organization_commit_cursor"
                    | "organization_reconstruction_batch_receipt"
                    | "organization_reconstruction_fence" | "organization_row_change"))
                .count(),
            "platform_global_count": 0,
            "platform_global_tables": [],
        }),
        None => serde_json::json!({ "verified": false }),
    };
    let schema_manifest_json = serde_json::to_string_pretty(&schema_manifest_value)
        .context("serialise schema manifest")?;
    write_file(&paths.schema_manifest_out, &schema_manifest_json)?;

    // ── 1b. Total storage-policy census ─────────────────────────────────

    let storage_policy_json = read_to_string(&paths.storage_policy_json)?;
    let resource_registry_json = read_to_string(&paths.resource_registry_json)?;
    let storage_policy_manifest_json = storage_policy_manifest_emit::emit_storage_policy_manifest(
        &storage_policy_json,
        &schema_manifest,
        &resource_registry_json,
    )
    .context("generating storage policy manifest")?;
    write_file(
        &paths.storage_policy_manifest_out,
        &storage_policy_manifest_json,
    )?;
    let storage_policy_manifest: Value = serde_json::from_str(&storage_policy_manifest_json)
        .context("re-parse generated storage policy manifest")?;
    let storage_coverage = &storage_policy_manifest["coverage"];
    let module_totals = storage_coverage["by_module"]
        .as_object()
        .context("storage policy coverage.by_module must be an object")?
        .iter()
        .map(|(module, count)| format!("{module}={count}"))
        .collect::<Vec<_>>()
        .join(", ");
    println!(
        "lumiere-codegen: storage policy coverage: {}/{} classified, {} unclassified; modules: {}",
        storage_coverage["classified"],
        storage_coverage["total"],
        storage_coverage["unclassified"],
        module_totals
    );
    println!("Wrote {}", paths.storage_policy_manifest_out.display());

    // ── 2. Archive manifest: generate the policy-derived eligible subset

    let archive_manifest_json = archive_manifest_emit::emit_archive_manifest_from_storage_policy(
        &storage_policy_json,
        &schema_manifest,
    )
    .context("generating archive manifest")?;
    write_file(&paths.archive_manifest_out, &archive_manifest_json)?;

    let candidates_value: Value = serde_json::from_str(&archive_manifest_json)
        .context("re-parse generated archive manifest for DDL step")?;
    let candidates_arr = candidates_value["candidates"]
        .as_array()
        .context("generated archive-manifest.json: 'candidates' must be an array")?;

    // ── 3. PG DDL: one SQL file per active archive candidate ───────────────

    let ddl_file_count = emit_ddl(paths, &schema_manifest, candidates_arr)?;

    for (file_name, ddl) in pg_ddl_emit::emit_commit_stream_ddl() {
        let ddl_path = paths.cold_ddl_dir.join(file_name);
        write_file(&ddl_path, &ddl)?;
        println!("Wrote {}", ddl_path.display());
    }

    // ── 4. Codec manifest: STDB ↔ PG type mapping per archive candidate ────

    let codec_manifest_json =
        codec_emit::emit_codec_manifest(&archive_manifest_json, &schema_manifest)
            .context("generating codec manifest")?;
    write_file(&paths.codec_manifest_out, &codec_manifest_json)?;
    println!("Wrote {}", paths.codec_manifest_out.display());

    let projection_codec_manifest_json = codec_emit::emit_projection_codec_manifest(
        &archive_manifest_json,
        &schema_manifest,
        &storage_policy_manifest,
    )
    .context("generating projection codec manifest")?;
    write_file(
        &paths.projection_codec_manifest_out,
        &projection_codec_manifest_json,
    )?;
    println!("Wrote {}", paths.projection_codec_manifest_out.display());

    // ── 4b. Versioned durable PG schema and migration ────────────────────

    let durable_migration =
        pg_migration_emit::emit_durable_migration(&schema_manifest, &storage_policy_manifest)
            .context("generating durable PostgreSQL migration")?;
    let migration_path = paths
        .durable_migration_dir
        .join(format!("{}.sql", pg_migration_emit::DURABLE_MIGRATION_NAME));
    write_file(&migration_path, &durable_migration.sql)?;
    write_file(
        &paths.durable_migration_manifest_out,
        &durable_migration.manifest,
    )?;
    println!("Wrote {}", migration_path.display());
    println!(
        "Wrote {} durable PG tables (checksum {})",
        durable_migration.applicable_table_count, durable_migration.sql_checksum
    );

    // ── 5. Hydration manifest: reducers that may target archived rows ──────

    let archive_tables: Vec<String> = candidates_arr
        .iter()
        .filter_map(|c| c["table"].as_str().map(String::from))
        .collect();
    let hydration_policies_json = read_to_string(&paths.hydration_policies_json)?;
    let durable_schema_manifest: Value = serde_json::from_str(&durable_migration.manifest)
        .context("re-parse generated durable schema manifest for hydration")?;
    let hydration_manifest_json = hydration_manifest_emit::emit_hydration_manifest_with_contracts(
        &hydration_policies_json,
        &schema_manifest,
        &archive_tables,
        &storage_policy_manifest,
        &durable_schema_manifest,
    )
    .context("generating hydration manifest")?;
    write_file(&paths.hydration_manifest_out, &hydration_manifest_json)?;
    println!("Wrote {}", paths.hydration_manifest_out.display());

    // ── 6. Reconstruction: reviewed relations + parent-first order ─────

    let reconstruction_policy_json = read_to_string(&paths.reconstruction_policy_json)?;
    let reconstruction_manifest_json = reconstruction_manifest_emit::emit_reconstruction_manifest(
        &reconstruction_policy_json,
        &schema_manifest,
        &storage_policy_manifest,
        &durable_schema_manifest,
    )
    .context("generating reconstruction manifest")?;
    write_file(
        &paths.reconstruction_manifest_out,
        &reconstruction_manifest_json,
    )?;
    let reconstruction_apply_rust = reconstruction_apply_emit::emit_reconstruction_apply(
        &reconstruction_manifest_json,
        &paths.spacetimedb_src_dir,
    )
    .context("generating closed SpacetimeDB reconstruction apply dispatch")?;
    write_file(
        &paths.reconstruction_apply_rust_out,
        &reconstruction_apply_rust,
    )?;
    println!("Wrote {}", paths.reconstruction_manifest_out.display());
    println!("Wrote {}", paths.reconstruction_apply_rust_out.display());

    println!(
        "lumiere-codegen: {} tables in schema IR ({} enum types) from {}",
        schema_manifest.tables.len(),
        schema_manifest.enum_types.len(),
        paths.stdb_bindings_dir.display()
    );
    println!(
        "lumiere-codegen: ownership summary: {}",
        ownership_counts
            .map(|counts| {
                format!(
                    "{} organization-owned, {} platform-global",
                    counts.erp_owned_count, counts.platform_global_count
                )
            })
            .unwrap_or_else(|| "ownership not verified (gate disabled)".to_string())
    );
    println!(
        "lumiere-codegen: {ddl_file_count} cold PG DDL file(s) from storage-policy-manifest.json"
    );
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
    for (index, cand) in candidates_arr.iter().enumerate() {
        let table = cand["table"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .with_context(|| format!("archive candidates[{index}].table is missing or empty"))?;
        let cold_table = cand["cold_table"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .with_context(|| {
                format!("archive candidates[{index}].cold_table is missing or empty")
            })?;
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
