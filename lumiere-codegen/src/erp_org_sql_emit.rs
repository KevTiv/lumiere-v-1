//! Emit `erp-org-sql.json` from `ERP_ORG_SQL` in `erp-subscriptions.ts`.

use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErpOrgSqlRow {
    pub map_key: String,
    pub resource_key: String,
    pub table: String,
    pub extra_where: String,
    pub order_by: String,
}

fn extract_erp_org_sql_block(ts: &str) -> Option<&str> {
    let start = ts.find("const ERP_ORG_SQL")?;
    let after = &ts[start..];
    let brace = after.find('{')? + start + 1;
    let mut depth = 1i32;
    let mut i = brace;
    let bytes = ts.as_bytes();
    while i < ts.len() && depth > 0 {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    if depth != 0 {
        return None;
    }
    Some(&ts[brace..i - 1])
}

fn split_map_entries(block: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut i = 0usize;
    let bytes = block.as_bytes();
    while i < block.len() {
        while i < block.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= block.len() {
            break;
        }
        let rest = &block[i..];
        let (map_key, key_len) = if let Some(stripped) = rest.strip_prefix('"') {
            let end = stripped.find('"').unwrap_or(stripped.len());
            (stripped[..end].to_string(), 1 + end + 1)
        } else {
            let end = rest
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '-')
                .unwrap_or(rest.len());
            (rest[..end].to_string(), end)
        };
        let after_key = &rest[key_len..];
        let Some(colon) = after_key.find(':') else {
            i += 1;
            continue;
        };
        let after_colon = after_key[colon + 1..].trim_start();
        if !after_colon.starts_with("(id") {
            i += 1;
            continue;
        }
        let entry_start = i + key_len + colon + 1;
        let mut j = entry_start;
        let mut paren = 0i32;
        let mut seen_arrow = false;
        while j < block.len() {
            let ch = block.as_bytes()[j];
            if ch == b'(' {
                paren += 1;
            } else if ch == b')' {
                paren -= 1;
            } else if ch == b'>' && paren == 0 {
                seen_arrow = true;
            } else if ch == b',' && paren <= 0 && seen_arrow {
                break;
            }
            j += 1;
        }
        let body = &block[entry_start..j].trim();
        out.push((map_key, body.to_string()));
        i = j + 1;
    }
    out
}

fn extract_quoted_string(s: &str) -> Option<(String, usize)> {
    let s = s.trim_start();
    if !s.starts_with('"') {
        return None;
    }
    let mut out = String::new();
    let mut esc = false;
    for (idx, ch) in s[1..].char_indices() {
        if esc {
            out.push(ch);
            esc = false;
            continue;
        }
        match ch {
            '\\' => esc = true,
            '"' => return Some((out, idx + 2)),
            c => out.push(c),
        }
    }
    None
}

fn parse_call_string_args(call_body: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut i = 0usize;
    let bytes = call_body.as_bytes();
    while i < call_body.len() {
        while i < call_body.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= call_body.len() {
            break;
        }
        if call_body[i..].starts_with('"') {
            if let Some((s, consumed)) = extract_quoted_string(&call_body[i..]) {
                args.push(s);
                i += consumed;
            } else {
                break;
            }
        } else {
            let mut depth = 0i32;
            while i < call_body.len() {
                match bytes[i] {
                    b'(' | b'{' | b'[' => depth += 1,
                    b')' | b'}' | b']' => {
                        if depth == 0 {
                            break;
                        }
                        depth -= 1;
                    }
                    b',' if depth == 0 => break,
                    _ => {}
                }
                i += 1;
            }
            args.push(String::new());
        }
        while i < call_body.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < call_body.len() && bytes[i] == b',' {
            i += 1;
        } else {
            break;
        }
    }
    args
}

fn parse_select_org_scoped(entry_body: &str) -> Option<(String, String, String, String)> {
    let idx = entry_body.find("selectOrgScopedSql(")?;
    let after = &entry_body[idx + "selectOrgScopedSql(".len()..];
    let mut depth = 1i32;
    let mut end = 0usize;
    for (off, ch) in after.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    end = off;
                    break;
                }
            }
            _ => {}
        }
    }
    if depth != 0 {
        return None;
    }
    let args = parse_call_string_args(&after[..end]);
    if args.len() < 5 {
        return None;
    }
    let resource_key = args[0].clone();
    let table = args[1].clone();
    let extra_where = args[4].clone();
    let order_by = args.get(5).cloned().unwrap_or_default();
    Some((resource_key, table, extra_where, order_by))
}

/// Parse `ERP_ORG_SQL` entries from `erp-subscriptions.ts`.
pub fn parse_erp_org_sql(ts: &str) -> Result<Vec<ErpOrgSqlRow>> {
    let block = extract_erp_org_sql_block(ts)
        .context("ERP_ORG_SQL block not found in erp-subscriptions.ts")?;
    let mut rows = Vec::new();
    for (map_key, body) in split_map_entries(block) {
        let (resource_key, table, extra_where, order_by) =
            parse_select_org_scoped(&body).with_context(|| {
                format!("parse selectOrgScopedSql for map key \"{map_key}\"")
            })?;
        rows.push(ErpOrgSqlRow {
            map_key,
            resource_key,
            table,
            extra_where,
            order_by,
        });
    }
    Ok(rows)
}

pub fn emit_erp_org_sql_json(ts: &str) -> Result<String> {
    let rows = parse_erp_org_sql(ts)?;
    let mut arr = Vec::new();
    for row in rows {
        arr.push(serde_json::json!({
            "mapKey": row.map_key,
            "resource_key": row.resource_key,
            "table": row.table,
            "extra_where": row.extra_where,
            "order_by": row.order_by,
        }));
    }
    serde_json::to_string_pretty(&Value::Array(arr))
        .map(|s| format!("{s}\n"))
        .context("serialize erp-org-sql.json")
}

pub fn registry_keys(registry_json: &str) -> Result<BTreeMap<String, ()>, String> {
    let root: Value = serde_json::from_str(registry_json)
        .map_err(|e| format!("parse resource_registry.json: {e}"))?;
    let Some(obj) = root.as_object() else {
        return Err("resource_registry.json root must be object".into());
    };
    Ok(obj.keys().map(|k| (k.clone(), ())).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multiline_select_org_scoped() {
        let src = r#"
const ERP_ORG_SQL = {
  "budget-lines": (id, fa) =>
    selectOrgScopedSql(
      "budget-lines",
      "crossovered_budget_lines",
      id,
      fa,
      "",
      " ORDER BY general_budget_id ASC, id ASC",
    ),
  budgets: (id, fa) =>
    selectOrgScopedSql("budgets", "crossovered_budget", id, fa, ""),
};
"#;
        let rows = parse_erp_org_sql(src).expect("parse");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].map_key, "budget-lines");
        assert_eq!(rows[0].resource_key, "budget-lines");
        assert_eq!(rows[0].table, "crossovered_budget_lines");
        assert_eq!(rows[0].order_by, " ORDER BY general_budget_id ASC, id ASC");
        assert_eq!(rows[1].map_key, "budgets");
    }

    #[test]
    fn parses_repo_erp_subscriptions_file() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../frontend/packages/stdb/src/queries/erp-subscriptions.ts");
        let ts = std::fs::read_to_string(&path).expect("read erp-subscriptions.ts");
        let rows = parse_erp_org_sql(&ts).expect("parse ERP_ORG_SQL");
        assert!(
            rows.len() >= 90,
            "expected ~97 ERP_ORG_SQL rows, got {}",
            rows.len()
        );
    }
}
