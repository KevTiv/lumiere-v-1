//! Emit `api-server-hooks.ts` — TanStack Query hooks for domain OpenAPI routes (not `/query` / `/call`).

use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

use crate::paths_emit::{
    collect_query_params, path_param_names, path_suffix_for_hooks, ts_fn_name_from_path,
};

fn skip_hooks_path(path: &str) -> bool {
    matches!(
        path,
        "/health" | "/v1/openapi.json" | "/v1/query/{resource}" | "/v1/call/{reducer}"
    )
}

fn parent_collection_path(p: &str) -> Option<String> {
    let parts: Vec<&str> = p.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }
    let last = parts.last()?;
    if !(last.starts_with('{') && last.ends_with('}')) {
        return None;
    }
    Some(format!("/{}", parts[..parts.len() - 1].join("/")))
}

fn get_paths_set(doc: &Value) -> HashSet<String> {
    let mut s = HashSet::new();
    let Some(paths) = doc.get("paths").and_then(|p| p.as_object()) else {
        return s;
    };
    for (path, item) in paths {
        if skip_hooks_path(path) {
            continue;
        }
        if let Some(obj) = item.as_object() {
            if obj.contains_key("get") {
                s.insert(path.clone());
            }
        }
    }
    s
}

fn invalidate_query_keys(mutation_path: &str, get_paths: &HashSet<String>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(parent) = parent_collection_path(mutation_path) {
        if get_paths.contains(&parent) {
            out.push(parent);
        }
    }
    if get_paths.contains(mutation_path) {
        out.push(mutation_path.to_string());
    }
    out.sort();
    out.dedup();
    out
}

fn capitalize_method(m: &str) -> String {
    let mut c = m.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

fn ts_path_literal(path: &str) -> String {
    serde_json::to_string(path).expect("path json")
}

/// Expression for `apiFetch(paths.url…(…))` first argument.
fn url_fetch_arg(
    openapi_path: &str,
    path_item: &Value,
    method: &str,
    list_query_var: Option<&str>,
) -> String {
    let fn_name = ts_fn_name_from_path(openapi_path);
    let path_params = path_param_names(openapi_path);
    let query = if method == "get" {
        collect_query_params(path_item)
    } else {
        vec![]
    };

    let mut parts: Vec<String> = path_params.iter().cloned().collect();
    if !query.is_empty() {
        parts.push(list_query_var.unwrap_or("listQuery").to_string());
    }

    if parts.is_empty() {
        format!("{fn_name}()")
    } else {
        format!("{fn_name}({})", parts.join(", "))
    }
}

fn query_key_array_expr(openapi_path: &str, path_params: &[String]) -> String {
    let path_lit = ts_path_literal(openapi_path);
    let mut inner = vec![
        "'api-gateway'".to_string(),
        "organizationId.toString()".to_string(),
        "'GET'".to_string(),
        path_lit,
    ];
    for p in path_params {
        inner.push(format!("{}.toString()", p));
    }
    format!("[{}]", inner.join(", "))
}

pub fn emit_hooks_typescript(doc: &Value) -> Result<String> {
    let paths = doc
        .get("paths")
        .and_then(|p| p.as_object())
        .context("OpenAPI paths missing")?;

    let get_paths = get_paths_set(doc);

    let mut used_url_fns: BTreeMap<String, ()> = BTreeMap::new();
    let mut hook_blocks: Vec<String> = Vec::new();

    let mut path_keys: Vec<_> = paths.keys().cloned().collect();
    path_keys.sort();

    for openapi_path in path_keys {
        if skip_hooks_path(&openapi_path) {
            continue;
        }
        let item = paths.get(&openapi_path).unwrap();
        let Some(item_obj) = item.as_object() else {
            continue;
        };

        for method in ["get", "post", "put", "patch", "delete"] {
            let Some(_op) = item_obj.get(method) else {
                continue;
            };
            let fn_name = ts_fn_name_from_path(&openapi_path);
            used_url_fns.insert(fn_name, ());

            let suffix = path_suffix_for_hooks(&openapi_path);
            let path_params = path_param_names(&openapi_path);

            if method == "get" {
                let hook = format!("useApiQuery{suffix}");
                let key_expr = query_key_array_expr(&openapi_path, &path_params);
                let query = collect_query_params(item);
                let fetch_arg = url_fetch_arg(&openapi_path, item, "get", Some("listQuery"));

                let mut fn_args = vec!["organizationId: bigint".to_string()];
                for p in &path_params {
                    fn_args.push(format!("{p}: string | number"));
                }
                if !query.is_empty() {
                    let fields: Vec<String> =
                        query.iter().map(|(n, t)| format!("  {n}?: {t}")).collect();
                    fn_args.push(format!("listQuery?: {{\n{}\n}}", fields.join("\n")));
                }
                fn_args.push(
                    "options?: Omit<UseQueryOptions<unknown, Error, unknown>, 'queryKey' | 'queryFn'>"
                        .to_string(),
                );
                let sig = fn_args.join(", ");

                let mut enabled_parts = vec![
                    "(options?.enabled ?? true)".to_string(),
                    "organizationId !== 0n".to_string(),
                ];
                for p in &path_params {
                    enabled_parts
                        .push(format!("({p} !== undefined && {p} !== null && {p} !== '')"));
                }

                let enabled_join = enabled_parts.join("\n      && ");

                hook_blocks.push(format!(
                    r#"/** OpenAPI `GET {openapi_path}` */
export function {hook}({sig}) {{
  const {{ enabled: enabledOpt, ...queryOptions }} = options ?? {{}}
  return useQuery({{
    ...queryOptions,
    queryKey: {key_expr},
    queryFn: async () => {{
      const r = await apiFetch({fetch_arg})
      return parseGatewayJson(r)
    }},
    enabled: {enabled_join} && enabledOpt !== false,
  }})
}}
"#,
                    openapi_path = openapi_path,
                    hook = hook,
                    sig = sig,
                    key_expr = key_expr,
                    fetch_arg = fetch_arg,
                    enabled_join = enabled_join,
                ));
            } else {
                let m_title = capitalize_method(method);
                let hook = format!("useApiMutation{m_title}{suffix}");
                let has_body = item_obj
                    .get(method)
                    .and_then(|o| o.as_object())
                    .and_then(|o| o.get("requestBody"))
                    .is_some();
                let invalidate_keys = invalidate_query_keys(&openapi_path, &get_paths);
                let invalidation = if invalidate_keys.is_empty() {
                    String::new()
                } else {
                    let mut lines = String::from("    onSuccess: () => {\n");
                    for k in &invalidate_keys {
                        let lit = ts_path_literal(k);
                        lines.push_str(&format!(
                            "      void qc.invalidateQueries({{ queryKey: ['api-gateway', organizationId.toString(), 'GET', {lit}] }})\n"
                        ));
                    }
                    lines.push_str("    },\n");
                    lines
                };

                let fetch_path = url_fetch_arg(&openapi_path, item, method, None);
                let u_fn = ts_fn_name_from_path(&openapi_path);

                let (mutation_sig, mutation_fn_body) = if path_params.is_empty() {
                    if has_body {
                        (
                            "body: unknown".to_string(),
                            format!(
                                r#"      const r = await apiFetch({fetch_path}, {{
        method: '{METHOD}',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify(body ?? {{}}),
      }})
      return parseGatewayJson(r)"#,
                                fetch_path = fetch_path,
                                METHOD = method.to_uppercase(),
                            ),
                        )
                    } else {
                        (
                            "_?: void".to_string(),
                            format!(
                                r#"      const r = await apiFetch({fetch_path}, {{ method: '{METHOD}' }})
      return parseGatewayJson(r)"#,
                                fetch_path = fetch_path,
                                METHOD = method.to_uppercase(),
                            ),
                        )
                    }
                } else if path_params.len() == 1 && method == "delete" && has_body {
                    let p = &path_params[0];
                    (
                        format!("vars: {{ {p}: string | number, body?: unknown }}"),
                        format!(
                            r#"      const init: RequestInit = {{ method: 'DELETE' }}
      if (vars.body !== undefined) {{
        init.headers = {{ 'Content-Type': 'application/json' }}
        init.body = JSON.stringify(vars.body)
      }}
      const r = await apiFetch({u_fn}(vars.{p}), init)
      return parseGatewayJson(r)"#,
                            u_fn = u_fn,
                            p = p,
                        ),
                    )
                } else if path_params.len() == 1 && has_body {
                    let p = &path_params[0];
                    (
                        format!("vars: {{ {p}: string | number, body: unknown }}"),
                        format!(
                            r#"      const r = await apiFetch({u_fn}(vars.{p}), {{
        method: '{METHOD}',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify(vars.body ?? {{}}),
      }})
      return parseGatewayJson(r)"#,
                            u_fn = u_fn,
                            p = p,
                            METHOD = method.to_uppercase(),
                        ),
                    )
                } else if path_params.len() == 1 {
                    let p = &path_params[0];
                    (
                        format!("{p}: string | number"),
                        format!(
                            r#"      const r = await apiFetch({u_fn}({p}), {{ method: '{METHOD}' }})
      return parseGatewayJson(r)"#,
                            u_fn = u_fn,
                            p = p,
                            METHOD = method.to_uppercase(),
                        ),
                    )
                } else {
                    continue;
                };

                hook_blocks.push(format!(
                    r#"/** OpenAPI `{METHOD} {openapi_path}` */
export function {hook}(organizationId: bigint) {{
  const qc = useQueryClient()
  return useMutation({{
    mutationFn: async ({mutation_sig}) => {{
{mutation_fn_body}
    }},
{invalidation}  }})
}}
"#,
                    METHOD = method.to_uppercase(),
                    openapi_path = openapi_path,
                    hook = hook,
                    mutation_sig = mutation_sig,
                    mutation_fn_body = mutation_fn_body,
                    invalidation = invalidation,
                ));
            }
        }
    }

    let imports: Vec<String> = used_url_fns.keys().cloned().collect();

    let out = format!(
        r#"// Auto-generated by `cargo run -p api-codegen`. Do not edit.
// TanStack Query hooks for Rust `api-server` domain routes (session + org from cookies).
// Prefer domain-specific hooks in `@/hooks/*` when they encode reducer payloads; use these for direct REST parity.

import type {{ UseQueryOptions }} from '@tanstack/react-query'
import {{ useMutation, useQuery, useQueryClient }} from '@tanstack/react-query'
import {{ apiFetch }} from '@/lib/api-fetch'
import {{ {imports} }} from './api-server-paths'

async function parseGatewayJson(r: Response): Promise<unknown> {{
  if (!r.ok) {{
    let msg = r.statusText
    try {{
      const j = (await r.json()) as {{ error?: string }}
      if (j.error) msg = j.error
    }} catch {{
      /* ignore */
    }}
    throw new Error(msg)
  }}
  return r.json()
}}

{hooks}
"#,
        imports = imports.join(", "),
        hooks = hook_blocks.join("\n"),
    );

    Ok(out)
}
