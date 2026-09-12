//! Validate `api-server/src/query_exec.rs` early-return match arms against the resource registry.
//!
//! Lint-only pipeline: it never writes a generated artifact, so `run` just
//! returns `Ok(())` on success.

use crate::paths::Paths;
use crate::support::read_to_string;
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::collections::BTreeSet;
use syn::{Expr, ExprPath, File, Item, Lit, Pat, Stmt};

pub fn run(paths: &Paths, registry_text: &str) -> Result<()> {
    let allowlist_json = read_to_string(&paths.query_exec_non_registry_json)?;
    let query_exec_rs = read_to_string(&paths.query_exec_rs)?;
    audit_query_exec_special_cases(&query_exec_rs, registry_text, &allowlist_json)
}

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

/// Parse early-return `match resource` arms (before the top-level fallback) from the
/// intended query dispatcher in `query_exec.rs`.
pub fn parse_early_special_resources(query_exec_rs: &str) -> Result<BTreeSet<String>> {
    let file: File = syn::parse_file(query_exec_rs).context("parse query_exec.rs")?;
    let dispatcher_names = [
        "execute_resource_query_for_company",
        "execute_resource_query",
    ];
    let dispatcher = dispatcher_names
        .iter()
        .find_map(|name| {
            file.items.iter().find_map(|item| match item {
                Item::Fn(function) if function.sig.ident == *name => Some(function),
                _ => None,
            })
        })
        .context("intended execute_resource_query dispatcher not found in query_exec.rs")?;

    let resource_match = dispatcher
        .block
        .stmts
        .iter()
        .find_map(|statement| match statement {
            Stmt::Expr(Expr::Match(expression), _) if is_resource_expr(&expression.expr) => {
                Some(expression)
            }
            _ => None,
        })
        .context("top-level match resource block not found in intended dispatcher")?;

    let mut resources = BTreeSet::new();
    let mut found_fallback = false;
    for arm in &resource_match.arms {
        if matches!(&arm.pat, Pat::Wild(_)) && arm.guard.is_none() {
            found_fallback = true;
        }
        for literal in pattern_resource_literals(&arm.pat)? {
            resources.insert(literal);
        }
    }
    if !found_fallback {
        bail!("match resource block has no top-level wildcard fallback");
    }
    Ok(resources)
}

fn is_resource_expr(expression: &Expr) -> bool {
    let Expr::Path(ExprPath {
        qself: None, path, ..
    }) = expression
    else {
        return false;
    };
    path.segments.len() == 1 && path.segments[0].ident == "resource"
}

fn pattern_resource_literals(pattern: &Pat) -> Result<Vec<String>> {
    Ok(match pattern {
        Pat::Lit(literal) => match &literal.lit {
            Lit::Str(value) => vec![value.value()],
            _ => bail!("resource dispatcher patterns must be string literals"),
        },
        Pat::Or(or) => {
            let mut resources = Vec::new();
            for case in &or.cases {
                resources.extend(pattern_resource_literals(case)?);
            }
            resources
        }
        Pat::Wild(_) => Vec::new(),
        _ => bail!("unsupported resource dispatcher pattern; audit cannot prove coverage"),
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::support::read_to_string;
    use std::path::PathBuf;

    fn manifest_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    #[test]
    fn query_exec_early_arms_align_with_registry_allowlist() {
        let paths = Paths::resolve(&manifest_dir());
        let registry_text = read_to_string(&paths.resource_registry_json).unwrap();
        run(&paths, &registry_text).expect("query_exec audit");
    }

    #[test]
    fn parse_early_arms_finds_known_virtual_resource() {
        let sample = r##"
fn authoritative_resource_scope(resource: &str) -> Option<()> {
    match resource {
        "not-an-early-arm" => Some(()),
        _ => None,
    }
}

pub async fn execute_resource_query_with_options() {
    match resource {
        "wrong-dispatcher" => { return Ok(vec![]); }
        _ => {}
    }
}

pub async fn execute_resource_query() {
    match resource {
        "nested-parent" => {
            /* braces in comments must not change match depth: { } */
            let _sql = r#"{"brace": true}"#;
            let _ = match resource {
                "nested-child" => true,
                _ => false,
            };
            return Ok(vec![]);
        }
        "import-jobs" | "policy-snapshots" => { return Ok(vec![]); }
        _ => {}
    }
}
"##;
        let keys = parse_early_special_resources(sample).unwrap();
        assert_eq!(
            keys,
            ["import-jobs", "nested-parent", "policy-snapshots"]
                .into_iter()
                .map(str::to_string)
                .collect()
        );
    }

    #[test]
    fn parse_actual_query_exec_selects_current_dispatcher() {
        let paths = Paths::resolve(&manifest_dir());
        let source = read_to_string(&paths.query_exec_rs).unwrap();
        let keys = parse_early_special_resources(&source).unwrap();
        assert!(keys.contains("roles"));
        assert!(!keys.contains("products"));
    }

    #[test]
    fn parse_early_arms_requires_fallback_sentinel() {
        let sample = r#"
pub async fn execute_resource_query_for_company() {
    match resource {
        "import-jobs" => { return Ok(vec![]); }
    }
}
"#;
        let error = parse_early_special_resources(sample).unwrap_err();
        assert!(error.to_string().contains("wildcard fallback"));
    }

    #[test]
    fn audit_rejects_unknown_and_stale_allowlist_entries() {
        let source = r#"
pub async fn execute_resource_query_for_company() {
    match resource {
        "user_2" => { return Ok(vec![]); }
        _ => {}
    }
}
"#;
        let unknown = audit_query_exec_special_cases(source, r#"{"known": {}}"#, "[]").unwrap_err();
        assert!(unknown.to_string().contains("user_2"));

        let stale =
            audit_query_exec_special_cases(source, r#"{"user_2": {}}"#, r#"["stale-resource"]"#)
                .unwrap_err();
        assert!(stale.to_string().contains("stale-resource"));
    }

    #[test]
    fn audit_fails_closed_for_uninspectable_patterns_and_guarded_fallback() {
        for arms in [
            "RESOURCE_CONSTANT => {}, _ => {}",
            "name => {}",
            "42 => {}, _ => {}",
            "\"known\" => {}, _ if allowed => {}",
        ] {
            let source = format!(
                "async fn execute_resource_query_for_company() {{ match resource {{ {arms} }} }}"
            );
            assert!(parse_early_special_resources(&source).is_err(), "{arms}");
        }
    }
}
