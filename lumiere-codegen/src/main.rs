//! Runs every codegen pipeline in sequence:
//!
//! 1. [`frontend_registry`] — resource registry + STDB types → frontend TS/JSON
//! 2. [`erp_org_sql`] — ERP org-subscription SQL, cross-checked against the registry
//! 3. [`query_exec_audit`] — lints `query_exec.rs` against the registry (no writes)
//! 4. [`cold_tier`] — STDB bindings → schema IR → PG DDL/codec/archive/hydration manifests
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
mod erp_org_sql;
mod frontend_registry;
mod paths;
mod query_exec_audit;
mod support;

use anyhow::Result;
use paths::Paths;
use std::path::Path;
use support::read_to_string;

fn main() -> Result<()> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let paths = Paths::resolve(manifest_dir);
    let registry_text = read_to_string(&paths.resource_registry_json)?;

    frontend_registry::run(&paths, &registry_text)?;
    erp_org_sql::run(&paths, &registry_text)?;
    query_exec_audit::run(&paths, &registry_text)?;
    cold_tier::run(&paths)?;

    Ok(())
}
