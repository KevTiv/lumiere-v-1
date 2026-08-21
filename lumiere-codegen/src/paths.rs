//! Every path `lumiere-codegen` reads from or writes to, resolved once.
//!
//! Each pipeline module takes a `&Paths` instead of joining `manifest_dir`
//! fragments itself — adding, renaming, or relocating a generated artifact
//! means editing exactly one field here instead of hunting through pipeline
//! logic for the join that produced it.

use crate::support::env_or_default;
use std::path::{Path, PathBuf};

pub struct Paths {
    // ── frontend_registry ────────────────────────────────────────────────
    pub resource_registry_json: PathBuf,
    /// `API_CODEGEN_REGISTRY_OUT` env override.
    pub query_registry_ts_out: PathBuf,
    pub reducer_stdb_invalidation_json: PathBuf,
    /// `API_CODEGEN_STDB_INVALIDATION_OUT` env override.
    pub stdb_invalidation_ts_out: PathBuf,
    pub types_ts: PathBuf,
    pub stdb_generated_dir: PathBuf,
    pub sql_columns_frontend_out: PathBuf,
    pub sql_columns_rust_out: PathBuf,
    pub query_resource_row_type_asset: PathBuf,
    pub query_resource_row_type_out: PathBuf,

    // ── erp_org_sql ──────────────────────────────────────────────────────
    pub erp_subscriptions_ts: PathBuf,
    pub erp_org_sql_rust_out: PathBuf,

    // ── query_exec_audit ─────────────────────────────────────────────────
    pub query_exec_non_registry_json: PathBuf,
    pub query_exec_rs: PathBuf,

    // ── cold_tier ────────────────────────────────────────────────────────
    pub stdb_bindings_dir: PathBuf,
    pub schema_manifest_out: PathBuf,
    pub archive_candidates_json: PathBuf,
    pub archive_manifest_out: PathBuf,
    pub cold_ddl_dir: PathBuf,
    pub codec_manifest_out: PathBuf,
    pub hydration_policies_json: PathBuf,
    pub hydration_manifest_out: PathBuf,
}

impl Paths {
    /// Resolve every path relative to `manifest_dir` (the `lumiere-codegen`
    /// crate root), honoring the same env-var output overrides the CLI has
    /// always supported.
    pub fn resolve(manifest_dir: &Path) -> Paths {
        let repo_root = manifest_dir.join("..");
        let assets = repo_root.join("crates/stdb-auth/assets");
        let frontend = repo_root.join("frontend");
        // Gitignored staging checkout for artifacts destined for the
        // `lumiere-contracts` repo (generated STDB Rust bindings + the six
        // generated manifests). Generation reads/writes staging;
        // `lumiere-v-1` itself never depends on these files directly at
        // runtime — that goes through the pinned `lumiere-contracts` crate
        // instead. See docs/plans/contracts-extraction-execution-plan.md.
        let contracts_staging_dir =
            PathBuf::from(env_or_default("CONTRACTS_STAGING_DIR", ".contracts-staging"));
        let staging_manifests = contracts_staging_dir.join("manifests");

        Paths {
            resource_registry_json: assets.join("resource_registry.json"),
            query_registry_ts_out: PathBuf::from(env_or_default(
                "API_CODEGEN_REGISTRY_OUT",
                "frontend/packages/stdb/src/generated/query-registry.ts",
            )),
            reducer_stdb_invalidation_json: manifest_dir.join("reducer-stdb-invalidation.json"),
            stdb_invalidation_ts_out: PathBuf::from(env_or_default(
                "API_CODEGEN_STDB_INVALIDATION_OUT",
                "frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts",
            )),
            types_ts: frontend.join("packages/stdb/src/generated/types.ts"),
            stdb_generated_dir: frontend.join("packages/stdb/src/generated"),
            sql_columns_frontend_out: frontend
                .join("packages/stdb/src/stdb-generated-sql-columns.json"),
            sql_columns_rust_out: staging_manifests.join("stdb-generated-sql-columns.json"),
            query_resource_row_type_asset: assets.join("query-resource-row-type.json"),
            query_resource_row_type_out: frontend
                .join("packages/stdb/src/query-resource-row-type.json"),

            erp_subscriptions_ts: frontend.join("packages/stdb/src/queries/erp-subscriptions.ts"),
            erp_org_sql_rust_out: staging_manifests.join("erp-org-sql.json"),

            query_exec_non_registry_json: assets.join("query_exec_non_registry.json"),
            query_exec_rs: repo_root.join("api-server/src/query_exec.rs"),

            stdb_bindings_dir: contracts_staging_dir.join("bindings"),
            schema_manifest_out: staging_manifests.join("lumiere-schema-manifest.json"),
            archive_candidates_json: manifest_dir.join("archive-candidates.json"),
            archive_manifest_out: staging_manifests.join("archive-manifest.json"),
            cold_ddl_dir: repo_root.join("api-server/src/generated/pg_ddl"),
            codec_manifest_out: staging_manifests.join("codec-manifest.json"),
            hydration_policies_json: manifest_dir.join("hydration-policies.json"),
            hydration_manifest_out: staging_manifests.join("hydration-manifest.json"),
        }
    }
}
