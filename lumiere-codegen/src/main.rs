//! Runs every codegen pipeline in sequence:
//!
//! 1. [`frontend_registry`] — resource registry + STDB types → frontend TS/JSON
//! 2. [`erp_org_sql`] — ERP org-subscription SQL, cross-checked against the registry
//! 3. [`query_exec_audit`] — lints `query_exec.rs` against the registry (no writes)
//! 4. [`cold_tier`] — STDB bindings → schema IR → PG/archive/hydration/reconstruction manifests
//! 5. [`contract_ir`] — canonical, versioned handoff for downstream emitters
//!
//! ```text
//! cargo run -p lumiere-codegen
//! API_CODEGEN_REGISTRY_OUT=frontend/packages/stdb/src/generated/query-registry.ts cargo run -p lumiere-codegen
//! API_CODEGEN_STDB_INVALIDATION_OUT=frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts
//! ```
//!
//! Every path each pipeline reads or writes lives in [`paths::Paths`] — add a
//! new generated artifact there, not as an inline `.join(...)` in a pipeline.

mod cold_tier;
mod contract_ir;
mod erp_org_sql;
mod frontend_registry;
mod paths;
mod query_exec_audit;
mod reducer_contract;
mod support;

use anyhow::Result;
use paths::Paths;
use std::path::Path;
use support::read_to_string;

fn main() -> Result<()> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let paths = Paths::resolve(manifest_dir);
    if std::env::args().any(|arg| arg == "--reconstruction-apply-only") {
        return cold_tier::run_reconstruction_apply(&paths);
    }
    // Capture provenance before any generator rewrites tracked outputs. The
    // generated files themselves are checked for drift after this process.
    let source_provenance = contract_ir::source_provenance()?;
    let registry_text = read_to_string(&paths.resource_registry_json)?;

    frontend_registry::run(&paths, &registry_text)?;
    erp_org_sql::run(&paths, &registry_text)?;
    query_exec_audit::run(&paths, &registry_text)?;
    cold_tier::run(&paths)?;
    reducer_contract::run(&paths)?;
    contract_ir::run(&paths, &registry_text, source_provenance)?;

    Ok(())
}
