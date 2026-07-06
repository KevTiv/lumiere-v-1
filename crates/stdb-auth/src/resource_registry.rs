//! Canonical query resource registry (`crates/stdb-auth/assets/resource_registry.json`).
//!
//! Edit the JSON asset, then run `make codegen` to refresh TypeScript `query-registry.ts`.

use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceEntry {
    pub table: String,
    pub aliases: Vec<String>,
    #[serde(rename = "default_restricted")]
    pub default_restricted: Vec<String>,
    pub mandatory: Vec<String>,
}

static RESOURCE_REGISTRY: Lazy<HashMap<String, ResourceEntry>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../assets/resource_registry.json"))
        .expect("resource_registry.json must be valid JSON")
});

/// Lookup a registered query resource by key (e.g. `"leads"`).
pub fn registry_get(key: &str) -> Option<&ResourceEntry> {
    RESOURCE_REGISTRY.get(key)
}

/// All registered query resource keys.
pub fn registry_keys() -> Vec<String> {
    let mut keys: Vec<String> = RESOURCE_REGISTRY.keys().cloned().collect();
    keys.sort();
    keys
}

/// JSON registry for codegen and tooling (canonical Rust-owned asset).
pub fn registry_json() -> &'static str {
    include_str!("../assets/resource_registry.json")
}
