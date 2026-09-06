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
    pub query_row_map_ts_out: PathBuf,

    // ── erp_org_sql ──────────────────────────────────────────────────────
    pub subscription_query_policy_json: PathBuf,
    pub org_subscription_descriptors_ts_out: PathBuf,
    pub erp_org_sql_rust_out: PathBuf,

    // ── query_exec_audit ─────────────────────────────────────────────────
    pub query_exec_non_registry_json: PathBuf,
    pub query_exec_rs: PathBuf,

    // ── cold_tier ────────────────────────────────────────────────────────
    pub stdb_bindings_dir: PathBuf,
    pub schema_manifest_out: PathBuf,
    pub storage_policy_json: PathBuf,
    pub storage_policy_manifest_out: PathBuf,
    pub archive_manifest_out: PathBuf,
    pub cold_ddl_dir: PathBuf,
    pub codec_manifest_out: PathBuf,
    pub projection_codec_manifest_out: PathBuf,
    pub durable_migration_dir: PathBuf,
    pub durable_migration_manifest_out: PathBuf,
    pub hydration_policies_json: PathBuf,
    pub hydration_manifest_out: PathBuf,
    pub reconstruction_policy_json: PathBuf,
    pub reconstruction_manifest_out: PathBuf,
    pub spacetimedb_src_dir: PathBuf,
    pub reconstruction_apply_rust_out: PathBuf,

    // ── reducer_contract ─────────────────────────────────────────────────
    pub module_schema_json: PathBuf,
    pub reducer_exposure_json: PathBuf,
    pub company_scope_metadata_json: PathBuf,
    pub contract_operation_ids_json: PathBuf,
    pub operation_contracts_dir: PathBuf,
    pub resource_scope_metadata_json: PathBuf,
    pub subscription_census_json: PathBuf,
    pub reducer_manifest_out: PathBuf,
    pub reducer_contract_rust_out: PathBuf,

    // ── canonical contract IR ───────────────────────────────────────────
    pub contract_ir_out: PathBuf,
    pub contract_ir_checksum_out: PathBuf,

    // ── query/subscription read descriptors ────────────────────────────
    pub read_descriptor_policy_json: PathBuf,
    pub read_descriptor_manifest_out: PathBuf,
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
        // `lumiere-contracts` repo (generated STDB Rust bindings + the seven
        // generated manifests). Generation reads/writes staging;
        // `lumiere-v-1` itself never depends on these files directly at
        // runtime — that goes through the pinned `lumiere-contracts` crate
        // instead. See docs/plans/contracts-extraction-execution-plan.md.
        let contracts_staging_dir = PathBuf::from(env_or_default(
            "CONTRACTS_STAGING_DIR",
            ".contracts-staging",
        ));
        let staging_manifests = contracts_staging_dir.join("manifests");
        // Gitignored staging for the TypeScript half of the same contracts
        // release: the raw `spacetime generate --lang typescript` output
        // plus lumiere-codegen's TS-emitting artifacts. Mirrors
        // `staging_manifests` above — see
        // docs/plans/contracts-extraction-execution-plan.md.
        let staging_ts = contracts_staging_dir.join("ts");

        Paths {
            resource_registry_json: assets.join("resource_registry.json"),
            query_registry_ts_out: PathBuf::from(env_or_default(
                "API_CODEGEN_REGISTRY_OUT",
                staging_ts
                    .join("generated/query-registry.ts")
                    .to_str()
                    .unwrap(),
            )),
            reducer_stdb_invalidation_json: manifest_dir.join("reducer-stdb-invalidation.json"),
            stdb_invalidation_ts_out: PathBuf::from(env_or_default(
                "API_CODEGEN_STDB_INVALIDATION_OUT",
                staging_ts
                    .join("stdb-reducer-invalidation.ts")
                    .to_str()
                    .unwrap(),
            )),
            types_ts: staging_ts.join("generated/types.ts"),
            stdb_generated_dir: staging_ts.join("generated"),
            sql_columns_frontend_out: staging_ts.join("stdb-generated-sql-columns.json"),
            sql_columns_rust_out: staging_manifests.join("stdb-generated-sql-columns.json"),
            query_resource_row_type_asset: assets.join("query-resource-row-type.json"),
            query_resource_row_type_out: frontend
                .join("packages/stdb/src/query-resource-row-type.json"),
            query_row_map_ts_out: frontend.join("packages/stdb/src/query-row-map.ts"),

            subscription_query_policy_json: manifest_dir.join("subscription-query-policies.json"),
            org_subscription_descriptors_ts_out: frontend
                .join("packages/stdb/src/generated/org-subscription-descriptors.ts"),
            erp_org_sql_rust_out: staging_manifests.join("erp-org-sql.json"),

            query_exec_non_registry_json: assets.join("query_exec_non_registry.json"),
            // Keep the audit compatible with the planned module split while preferring the
            // current flat source when both paths exist during a transition.
            query_exec_rs: {
                let flat = repo_root.join("api-server/src/query_exec.rs");
                if flat.is_file() {
                    flat
                } else {
                    repo_root.join("api-server/src/query_exec/mod.rs")
                }
            },

            stdb_bindings_dir: contracts_staging_dir.join("bindings"),
            schema_manifest_out: staging_manifests.join("lumiere-schema-manifest.json"),
            storage_policy_json: manifest_dir.join("storage-policy-manifest.json"),
            storage_policy_manifest_out: staging_manifests.join("storage-policy-manifest.json"),
            archive_manifest_out: staging_manifests.join("archive-manifest.json"),
            cold_ddl_dir: staging_manifests.join("pg_ddl"),
            codec_manifest_out: staging_manifests.join("codec-manifest.json"),
            projection_codec_manifest_out: staging_manifests.join("projection-codec-manifest.json"),
            durable_migration_dir: staging_manifests.join("pg_ddl/migrations"),
            durable_migration_manifest_out: staging_manifests
                .join("durable-pg-schema-manifest.json"),
            hydration_policies_json: manifest_dir.join("hydration-policies.json"),
            hydration_manifest_out: staging_manifests.join("hydration-manifest.json"),
            reconstruction_policy_json: manifest_dir.join("reconstruction-policy.json"),
            reconstruction_manifest_out: staging_manifests.join("reconstruction-manifest.json"),
            spacetimedb_src_dir: repo_root.join("spacetimedb/src"),
            reconstruction_apply_rust_out: repo_root
                .join("spacetimedb/src/generated_reconstruction_apply.rs"),

            module_schema_json: contracts_staging_dir.join("module-schema.json"),
            reducer_exposure_json: manifest_dir.join("reducer-exposure.json"),
            company_scope_metadata_json: manifest_dir.join("company-scope-metadata.json"),
            contract_operation_ids_json: manifest_dir.join("contract-operation-ids.json"),
            operation_contracts_dir: manifest_dir.join("operation-contracts"),
            resource_scope_metadata_json: manifest_dir.join("resource-scope-metadata.json"),
            subscription_census_json: assets.join("subscription-census.json"),
            reducer_manifest_out: staging_manifests.join("reducer-manifest.json"),
            reducer_contract_rust_out: repo_root
                .join("crates/stdb-client/src/generated_reducer_contract.rs"),

            contract_ir_out: contracts_staging_dir.join("ir/lumiere-contract-ir-v2.json"),
            contract_ir_checksum_out: contracts_staging_dir
                .join("ir/lumiere-contract-ir-v2.json.sha256"),
            read_descriptor_policy_json: manifest_dir.join("read-descriptor-policies.json"),
            read_descriptor_manifest_out: staging_manifests.join("read-plan-descriptors.json"),
        }
    }
}
