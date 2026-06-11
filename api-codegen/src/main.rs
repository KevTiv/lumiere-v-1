//! Loads the OpenAPI document from the `api-server` crate (no HTTP by default) and emits
//! TypeScript URL builders (`api-server-paths.ts`) and optional TanStack Query hooks (`api-server-hooks.ts`).
//!
//! ```text
//! cargo run -p api-codegen
//! API_CODEGEN_OUT=frontend/web/lib/generated/api-server-paths.ts cargo run -p api-codegen
//! API_CODEGEN_HOOKS_OUT=frontend/web/lib/generated/api-server-hooks.ts cargo run -p api-codegen
//! API_OPENAPI_URL=http://127.0.0.1:8082/v1/openapi.json cargo run -p api-codegen   # remote/file
//! API_CODEGEN_STDB_INVALIDATION_OUT — optional path override for stdb reducer invalidation map
//! ```

mod hooks_emit;
mod paths_emit;
mod stdb_invalidation_emit;

use anyhow::{Context, Result};
use serde_json::Value;
use std::fs;
use std::path::Path;

#[tokio::main]
async fn main() -> Result<()> {
    let url = std::env::var("API_OPENAPI_URL").ok();

    let v: Value = if let Some(ref u) = url {
        let text = if u.starts_with("file://") {
            let path = u.trim_start_matches("file://");
            fs::read_to_string(path).with_context(|| format!("read {path}"))?
        } else {
            reqwest::get(u)
                .await
                .with_context(|| format!("GET {u}"))?
                .text()
                .await
                .context("read body")?
        };
        serde_json::from_str(&text).context("parse OpenAPI JSON")?
    } else {
        api_server::openapi_document()
    };

    let title = v
        .pointer("/info/title")
        .and_then(|x| x.as_str())
        .unwrap_or("?");
    let version = v
        .pointer("/info/version")
        .and_then(|x| x.as_str())
        .unwrap_or("?");
    let path_count = v
        .get("paths")
        .and_then(|p| p.as_object())
        .map(|o| o.len())
        .unwrap_or(0);

    let paths_out = env_or_default(
        "API_CODEGEN_OUT",
        "frontend/web/lib/generated/api-server-paths.ts",
    );
    let paths_path = Path::new(&paths_out);
    if let Some(parent) = paths_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    let paths_ts = paths_emit::emit_paths_typescript(&v)?;
    fs::write(paths_path, &paths_ts).with_context(|| format!("write {}", paths_path.display()))?;

    let hooks_out = env_or_default(
        "API_CODEGEN_HOOKS_OUT",
        "frontend/web/lib/generated/api-server-hooks.ts",
    );
    let hooks_path = Path::new(&hooks_out);
    if let Some(parent) = hooks_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    let hooks_ts = hooks_emit::emit_hooks_typescript(&v)?;
    fs::write(hooks_path, &hooks_ts).with_context(|| format!("write {}", hooks_path.display()))?;

    let manifest_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("reducer-stdb-invalidation.json");
    let stdb_inv_out = env_or_default(
        "API_CODEGEN_STDB_INVALIDATION_OUT",
        "frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts",
    );
    let stdb_inv_path = Path::new(&stdb_inv_out);
    if let Some(parent) = stdb_inv_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }
    let manifest_text = fs::read_to_string(&manifest_path)
        .with_context(|| format!("read {}", manifest_path.display()))?;
    let manifest: Value = serde_json::from_str(&manifest_text)
        .with_context(|| format!("parse {}", manifest_path.display()))?;
    let stdb_inv_ts = stdb_invalidation_emit::emit_std_invalidation_typescript(&manifest)?;
    fs::write(stdb_inv_path, stdb_inv_ts)
        .with_context(|| format!("write {}", stdb_inv_path.display()))?;

    let source = url.as_deref().unwrap_or("api_server::openapi_document()");
    println!("OpenAPI {title} v{version} — {path_count} paths (from {source})");
    println!("Wrote {}", paths_path.display());
    println!("Wrote {}", hooks_path.display());
    println!("Wrote {}", stdb_inv_path.display());
    Ok(())
}

fn env_or_default(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
