//! Emit `stdb-generated-sql-columns.json` from SpacetimeDB generated bindings.
//!
//! Table row types: `frontend/packages/stdb/src/generated/*_table.ts` (authoritative `.name()` SQL).
//! Params / value types: `generated/types.ts` (`__t.object` blocks).

use anyhow::{Context, Result};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Match `camelToSnakeIdentifier` in `frontend/packages/erp-shared/src/stdb-params-json.ts`.
fn camel_to_snake(name: &str) -> String {
    const REL_SUFFIXES: &[&str] = &["M2O", "M2M", "O2M"];
    for suffix in REL_SUFFIXES {
        if let Some(base) = name.strip_suffix(suffix) {
            return format!("{}_{}", snakeify_base(base), suffix.to_lowercase());
        }
    }
    snakeify_base(name)
}

fn field_to_sql_column(field: &str) -> String {
    if field.chars().any(|c| c.is_ascii_uppercase()) {
        camel_to_snake(field)
    } else {
        field.to_string()
    }
}

fn snakeify_base(s: &str) -> String {
    let mut out = apply_pattern_lz(s);
    out = apply_pattern_dz(&out);
    out = apply_pattern_az_z(&out);
    out.to_lowercase()
}

/// `([a-z])(\d)` → `$1_$2`
fn apply_pattern_lz(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    for (i, ch) in chars.iter().enumerate() {
        if ch.is_ascii_lowercase() {
            if chars.get(i + 1).is_some_and(|next| next.is_ascii_digit()) {
                out.push(*ch);
                out.push('_');
                continue;
            }
        }
        out.push(*ch);
    }
    out
}

/// `(\d)([A-Z])` → `$1_$2`
fn apply_pattern_dz(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    for (i, ch) in chars.iter().enumerate() {
        if ch.is_ascii_digit() {
            if chars
                .get(i + 1)
                .is_some_and(|next| next.is_ascii_uppercase())
            {
                out.push(*ch);
                out.push('_');
                continue;
            }
        }
        out.push(*ch);
    }
    out
}

/// `([a-z0-9])([A-Z])` → `$1_$2`
fn apply_pattern_az_z(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    for (i, ch) in chars.iter().enumerate() {
        let prev_is_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        if prev_is_lower_or_digit {
            if chars
                .get(i + 1)
                .is_some_and(|next| next.is_ascii_uppercase())
            {
                out.push(*ch);
                out.push('_');
                continue;
            }
        }
        out.push(*ch);
    }
    out
}

fn extract_name_attr(line: &str) -> Option<String> {
    let needle = ".name(\"";
    let idx = line.find(needle)?;
    let rest = &line[idx + needle.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn table_file_to_type_name(filename: &str) -> Option<String> {
    let stem = filename.strip_suffix("_table.ts")?;
    if stem.is_empty() {
        return None;
    }
    Some(
        stem.split('_')
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                }
            })
            .collect(),
    )
}

/// Parse `export default __t.row({ ... })` table bindings.
pub fn parse_table_ts_columns(table_ts: &str) -> Vec<String> {
    let Some(body) = extract_row_object_body(table_ts) else {
        return Vec::new();
    };

    let mut cols = Vec::new();
    let mut i = 0usize;
    let bytes = body.as_bytes();

    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }

        if body[i..].starts_with("get ") {
            let Some((name, end)) = parse_getter_field(&body[i..]) else {
                break;
            };
            cols.push(name);
            i += end;
            continue;
        }

        let Some((name, end)) = parse_plain_field(&body[i..]) else {
            i += 1;
            continue;
        };
        cols.push(name);
        i += end;
    }

    cols
}

fn extract_row_object_body(table_ts: &str) -> Option<String> {
    let marker = "__t.row({";
    let start = table_ts.find(marker)? + marker.len();
    let mut depth = 1i32;
    let mut i = start;
    let bytes = table_ts.as_bytes();
    while i < table_ts.len() && depth > 0 {
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
    Some(table_ts[start..i - 1].to_string())
}

fn parse_getter_field(slice: &str) -> Option<(String, usize)> {
    let rest = slice.strip_prefix("get ")?;
    let paren = rest.find("()")?;
    let getter = rest[..paren].trim();
    if getter.is_empty() {
        return None;
    }
    let brace_start = rest[paren + 2..].find('{')? + paren + 2;
    let mut depth = 0i32;
    let bytes = slice.as_bytes();
    let mut end = brace_start;
    for (offset, ch) in slice[brace_start..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = brace_start + offset + 1;
                    break;
                }
            }
            _ => {}
        }
    }
    if depth != 0 {
        return None;
    }
    let getter_body = &slice[brace_start + 1..end - 1];
    let sql_name = extract_name_attr(getter_body).unwrap_or_else(|| field_to_sql_column(getter));
    let mut advance = end;
    while advance < slice.len() && bytes[advance].is_ascii_whitespace() {
        advance += 1;
    }
    if slice[advance..].starts_with(',') {
        advance += 1;
    }
    Some((sql_name, advance))
}

fn parse_plain_field(slice: &str) -> Option<(String, usize)> {
    let colon = slice.find(':')?;
    let field = slice[..colon].trim();
    if field.is_empty()
        || !field
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
    {
        return None;
    }
    if !slice[colon + 1..].contains("__t.") {
        return None;
    }
    let line_end = slice.find(',').unwrap_or(slice.len());
    let line = &slice[..line_end];
    let sql_name = extract_name_attr(line).unwrap_or_else(|| field_to_sql_column(field));
    let mut advance = line_end;
    if advance < slice.len() && slice.as_bytes()[advance] == b',' {
        advance += 1;
    }
    Some((sql_name, advance))
}

pub fn parse_table_dir_columns(generated_dir: &Path) -> Result<BTreeMap<String, Vec<String>>> {
    let mut out = BTreeMap::new();
    for entry in fs::read_dir(generated_dir)
        .with_context(|| format!("read_dir {}", generated_dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if !file_name.ends_with("_table.ts") {
            continue;
        }
        let Some(type_name) = table_file_to_type_name(file_name) else {
            continue;
        };
        let content =
            fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        let cols = parse_table_ts_columns(&content);
        if !cols.is_empty() {
            out.insert(type_name, cols);
        }
    }
    Ok(out)
}

/// Parse `export const Foo = __t.object("Foo", { ... });` blocks from generated types.ts.
pub fn parse_types_ts_columns(types_ts: &str) -> BTreeMap<String, Vec<String>> {
    let mut out = BTreeMap::new();
    let marker = "export const ";
    let mut search_from = 0usize;

    while let Some(start) = types_ts[search_from..].find(marker) {
        let abs = search_from + start;
        let rest = &types_ts[abs + marker.len()..];
        let Some(eq) = rest.find(" = __t.object(") else {
            search_from = abs + marker.len();
            continue;
        };
        let type_name = rest[..eq].trim();
        if type_name.is_empty()
            || !type_name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            search_from = abs + marker.len();
            continue;
        }

        let after_obj = &rest[eq + " = __t.object(".len()..];
        let Some(open_brace) = after_obj.find('{') else {
            search_from = abs + marker.len();
            continue;
        };
        let body_start = abs + marker.len() + eq + " = __t.object(".len() + open_brace + 1;

        let mut depth = 1i32;
        let mut i = body_start;
        let bytes = types_ts.as_bytes();
        while i < types_ts.len() && depth > 0 {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        if depth != 0 {
            break;
        }
        let body = &types_ts[body_start..i - 1];

        let mut cols = Vec::new();
        for line in body.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("get ") {
                if let Some(name) = trimmed
                    .strip_prefix("get ")
                    .and_then(|s| s.split('(').next())
                    .map(str::trim)
                    .filter(|n| !n.is_empty())
                {
                    cols.push(field_to_sql_column(name));
                }
                continue;
            }
            let Some(colon) = trimmed.find(':') else {
                continue;
            };
            let field = trimmed[..colon].trim();
            if field.is_empty()
                || !field
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() && c != '_')
            {
                continue;
            }
            if !trimmed[colon + 1..].trim_start().starts_with("__t.") {
                continue;
            }
            cols.push(field_to_sql_column(field));
        }

        if !cols.is_empty() {
            out.insert(type_name.to_string(), cols);
        }

        search_from = i;
    }

    out
}

pub fn emit_sql_columns_json(types_ts: &str, generated_dir: &Path) -> Result<String> {
    let mut merged = parse_table_dir_columns(generated_dir)?;
    for (k, v) in parse_types_ts_columns(types_ts) {
        merged.entry(k).or_insert(v);
    }

    let mut root = Map::new();
    for (k, v) in merged {
        root.insert(k, Value::Array(v.into_iter().map(Value::String).collect()));
    }
    serde_json::to_string_pretty(&Value::Object(root))
        .map(|s| format!("{s}\n"))
        .context("serialize sql columns json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_table_name_attr_and_fallback() {
        let src = r#"
export default __t.row({
  id: __t.u64().primaryKey(),
  costPer1KTokens: __t.f64().name("cost_per_1_k_tokens"),
  street2: __t.option(__t.string()).name("street_2"),
  get moveType() {
    return MoveType.name("move_type");
  },
  get state() {
    return AccountMoveState;
  },
  name: __t.string(),
});
"#;
        let cols = parse_table_ts_columns(src);
        assert_eq!(
            cols,
            &[
                "id".to_string(),
                "cost_per_1_k_tokens".to_string(),
                "street_2".to_string(),
                "move_type".to_string(),
                "state".to_string(),
                "name".to_string(),
            ]
        );
    }

    #[test]
    fn table_file_to_type_name_examples() {
        assert_eq!(
            table_file_to_type_name("contact_table.ts").as_deref(),
            Some("Contact")
        );
        assert_eq!(
            table_file_to_type_name("account_account_table.ts").as_deref(),
            Some("AccountAccount")
        );
    }

    #[test]
    fn parses_object_fields_and_snake_cases() {
        let src = r#"
export const AccountAccount = __t.object("AccountAccount", {
  id: __t.u64(),
  organizationId: __t.u64(),
  get internalType() {
    return __t.option(AccountTypeInternal);
  },
  isBankAccount: __t.bool(),
});
"#;
        let map = parse_types_ts_columns(src);
        let cols = map.get("AccountAccount").expect("AccountAccount");
        assert_eq!(
            cols,
            &[
                "id".to_string(),
                "organization_id".to_string(),
                "internal_type".to_string(),
                "is_bank_account".to_string(),
            ]
        );
    }

    #[test]
    fn camel_to_snake_matches_stdb_params_json() {
        assert_eq!(camel_to_snake("showLotsM2O"), "show_lots_m2o");
        assert_eq!(camel_to_snake("image1920Url"), "image_1920_url");
        assert_eq!(camel_to_snake("image128Url"), "image_128_url");
        assert_eq!(camel_to_snake("costPer1KTokens"), "cost_per_1_ktokens");
    }

    #[test]
    fn emits_sorted_json_keys() {
        let src = r#"
export const Zed = __t.object("Zed", { id: __t.u64() });
export const Alpha = __t.object("Alpha", { name: __t.string() });
"#;
        let keys: Vec<_> = parse_types_ts_columns(src).keys().cloned().collect();
        assert_eq!(keys, vec!["Alpha".to_string(), "Zed".to_string()]);
    }
}
