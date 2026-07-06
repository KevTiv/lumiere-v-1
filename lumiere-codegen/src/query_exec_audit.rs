//! Validate `api-server/src/query_exec.rs` early-return match arms against the resource registry.

use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

/// Resources with custom SQL in `execute_resource_query` that are intentionally absent from
/// `resource_registry.json` (virtual/inbox views, import jobs, policy snapshots, etc.).
pub fn load_non_registry_allowlist(registry_json: &str) -> Result<BTreeSet<String>> {
    let v: Value = serde_json::from_str(registry_json).context("parse allowlist JSON")?;
    let arr = v
        .as_array()
        .context("query_exec_non_registry.json must be a JSON array")?;
    Ok(arr
        .iter()
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect())
}

pub fn registry_key_set(registry_json: &str) -> Result<BTreeSet<String>> {
    let v: Value = serde_json::from_str(registry_json).context("parse resource_registry.json")?;
    let obj = v
        .as_object()
        .context("resource_registry.json must be an object")?;
    Ok(obj.keys().cloned().collect())
}

/// Parse early-return `match resource` arms (before `_ => {}`) from `query_exec.rs`.
pub fn parse_early_special_resources(query_exec_rs: &str) -> Result<BTreeSet<String>> {
    let fn_start = query_exec_rs
        .find("pub async fn execute_resource_query")
        .context("execute_resource_query not found in query_exec.rs")?;
    let match_start = query_exec_rs[fn_start..]
        .find("match resource {")
        .context("match resource block not found")?
        + fn_start;

    let mut resources = BTreeSet::new();
    let mut pattern_buf = String::new();

    for line in query_exec_rs[match_start..].lines().skip(1) {
        if line.trim() == "_ => {}" {
            break;
        }
        // Arm patterns are indented with 8 spaces; bodies use 12+.
        if !(line.starts_with("        ") && !line.starts_with("            ")) {
            continue;
        }
        let trimmed = line.trim();
        if !(trimmed.starts_with('"') || trimmed.starts_with('|')) {
            continue;
        }

        pattern_buf.push(' ');
        pattern_buf.push_str(trimmed);
        if trimmed.contains("=>") {
            for key in extract_quoted_keys(pattern_buf.split("=>").next().unwrap_or("")) {
                resources.insert(key);
            }
            pattern_buf.clear();
        }
    }

    if !pattern_buf.is_empty() {
        bail!("unfinished match arm pattern near end of early match block");
    }

    Ok(resources)
}

fn extract_quoted_keys(fragment: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = fragment;
    while let Some(start) = rest.find('"') {
        rest = &rest[start + 1..];
        let Some(end) = rest.find('"') else {
            break;
        };
        let key = &rest[..end];
        if !key.is_empty() && key.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
            out.push(key.to_string());
        }
        rest = &rest[end + 1..];
    }
    out
}

pub fn audit_query_exec_special_cases(
    query_exec_rs: &str,
    registry_json: &str,
    allowlist_json: &str,
) -> Result<()> {
    let registry = registry_key_set(registry_json)?;
    let allowlist = load_non_registry_allowlist(allowlist_json)?;
    let early = parse_early_special_resources(query_exec_rs)?;

    let not_in_registry: BTreeSet<_> = early.difference(&registry).cloned().collect();

    for key in &not_in_registry {
        if !allowlist.contains(key) {
            bail!(
                "query_exec early-return resource \"{key}\" is not in resource_registry.json \
                 and not listed in query_exec_non_registry.json"
            );
        }
    }

    for key in &allowlist {
        if registry.contains(key) {
            bail!(
                "query_exec_non_registry.json lists \"{key}\" but it exists in resource_registry.json — remove from allowlist"
            );
        }
        if !early.contains(key) {
            bail!(
                "query_exec_non_registry.json lists \"{key}\" but no early-return match arm exists in query_exec.rs"
            );
        }
    }

    let stale_allowlist: BTreeSet<_> = allowlist.difference(&not_in_registry).cloned().collect();
    if !stale_allowlist.is_empty() {
        bail!(
            "query_exec_non_registry.json contains stale entries not used as non-registry early arms: {:?}",
            stale_allowlist
        );
    }

    Ok(())
}

pub fn audit_query_exec_from_paths(manifest_dir: &Path) -> Result<()> {
    let query_exec = manifest_dir.join("../api-server/src/query_exec.rs");
    let registry = manifest_dir.join("../crates/stdb-auth/assets/resource_registry.json");
    let allowlist = manifest_dir
        .join("../crates/stdb-auth/assets/query_exec_non_registry.json");

    let query_exec_rs = fs::read_to_string(&query_exec)
        .with_context(|| format!("read {}", query_exec.display()))?;
    let registry_json = fs::read_to_string(&registry)
        .with_context(|| format!("read {}", registry.display()))?;
    let allowlist_json = fs::read_to_string(&allowlist)
        .with_context(|| format!("read {}", allowlist.display()))?;

    audit_query_exec_special_cases(&query_exec_rs, &registry_json, &allowlist_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn manifest_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn query_exec_early_arms_align_with_registry_allowlist() {
        audit_query_exec_from_paths(&manifest_dir()).expect("query_exec audit");
    }

    #[test]
    fn parse_early_arms_finds_known_virtual_resource() {
        let sample = r#"
pub async fn execute_resource_query() {
    match resource {
        "import-jobs" => { return Ok(vec![]); }
        _ => {}
    }
}
"#;
        let keys = parse_early_special_resources(sample).unwrap();
        assert!(keys.contains("import-jobs"));
    }
}
