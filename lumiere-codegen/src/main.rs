//! Loads canonical registries from `stdb-auth` and emits TypeScript for the frontend.
//!
//! ```text
//! cargo run -p lumiere-codegen
//! API_CODEGEN_REGISTRY_OUT=frontend/packages/stdb/src/generated/query-registry.ts cargo run -p lumiere-codegen
//! API_CODEGEN_STDB_INVALIDATION_OUT=frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts
//! ```

mod registry_emit;
mod stdb_invalidation_emit;

use anyhow::{Context, Result};
use serde_json::Value;
use std::fs;
use std::path::Path;

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
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
    if let Some(parent) = registry_path_out.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    let registry_ts = registry_emit::emit_query_registry_typescript(&registry_text)?;
    fs::write(registry_path_out, &registry_ts)
        .with_context(|| format!("write {}", registry_path_out.display()))?;

    let invalidation_manifest = manifest_dir.join("reducer-stdb-invalidation.json");
    let stdb_inv_out = env_or_default(
        "API_CODEGEN_STDB_INVALIDATION_OUT",
        "frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts",
    );
    let stdb_inv_path = Path::new(&stdb_inv_out);
    if let Some(parent) = stdb_inv_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    let manifest_text = fs::read_to_string(&invalidation_manifest)
        .with_context(|| format!("read {}", invalidation_manifest.display()))?;
    let manifest: Value = serde_json::from_str(&manifest_text)
        .with_context(|| format!("parse {}", invalidation_manifest.display()))?;
    let stdb_inv_ts = stdb_invalidation_emit::emit_std_invalidation_typescript(&manifest)?;
    fs::write(stdb_inv_path, stdb_inv_ts)
        .with_context(|| format!("write {}", stdb_inv_path.display()))?;

    let key_count = serde_json::from_str::<Value>(&registry_text)?
        .as_object()
        .map(|o| o.len())
        .unwrap_or(0);

    println!(
        "lumiere-codegen: {key_count} registry keys from {}",
        registry_path.display()
    );
    println!("Wrote {}", registry_path_out.display());
    println!("Wrote {}", stdb_inv_path.display());
    Ok(())
}
