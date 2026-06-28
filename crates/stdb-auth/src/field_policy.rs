//! Port of `frontend/packages/stdb/src/field-policy.ts` (registry + column resolution + SQL helpers).
//!
//! Keep `assets/resource_registry.json`, `assets/query-resource-row-type.json`, and
//! `assets/stdb-generated-sql-columns.json` aligned with the frontend copies when adding query resources.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceEntry {
    pub table: String,
    pub aliases: Vec<String>,
    pub default_restricted: Vec<String>,
    pub mandatory: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldAccessContext {
    pub organization_id: u64,
    pub role_id: u64,
    pub role_name: String,
    pub is_superuser: bool,
    pub role_permissions: Vec<String>,
    pub identity_hex: String,
    pub casbin_rules: Vec<CasbinRuleLike>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CasbinRuleLike {
    #[serde(default)]
    pub ptype: String,
    #[serde(default)]
    pub v0: Option<String>,
    #[serde(default)]
    pub v1: Option<String>,
    #[serde(default)]
    pub v2: Option<String>,
    #[serde(default)]
    pub v3: Option<String>,
    #[serde(default)]
    pub v4: Option<String>,
    #[serde(default)]
    pub v5: Option<String>,
    #[serde(default)]
    pub metadata: Option<String>,
}

static RESOURCE_REGISTRY: Lazy<HashMap<String, ResourceEntry>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../assets/resource_registry.json"))
        .expect("resource_registry.json")
});

static STDB_GENERATED_SQL_COLUMNS: Lazy<HashMap<String, Vec<String>>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../assets/stdb-generated-sql-columns.json"))
        .expect("stdb-generated-sql-columns.json")
});

static HTTP_SQL_EXCLUDED_COLUMNS: Lazy<HashMap<String, HashSet<String>>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert(
        "activities".to_string(),
        [
            "user_id", "assigned_to", "created_by", "date_deadline", "date_done",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
    );
    m.insert(
        "roles".to_string(),
        ["permissions"].into_iter().map(String::from).collect(),
    );
    m
});

static GLOBAL_HTTP_SQL_EXCLUDED_COLUMNS: Lazy<HashSet<String>> = Lazy::new(|| {
    [
        "metadata",
        "create_uid",
        "write_uid",
        "create_date",
        "write_date",
        "created_at",
        "updated_at",
        "deleted_at",
        "message_follower_ids",
        "message_ids",
        "activity_ids",
        "tag_ids",
    ]
    .into_iter()
    .map(String::from)
    .collect()
});

fn filter_http_sql_unsafe_columns(
    cols: &[String],
    resource_key: Option<&str>,
) -> Vec<String> {
    let resource_excluded = resource_key.and_then(|k| HTTP_SQL_EXCLUDED_COLUMNS.get(k));
    cols.iter()
        .filter(|col| {
            if GLOBAL_HTTP_SQL_EXCLUDED_COLUMNS.contains(*col) {
                return false;
            }
            if let Some(ex) = resource_excluded {
                if ex.contains(*col) {
                    return false;
                }
            }
            if col.ends_with("_ids") {
                return false;
            }
            true
        })
        .cloned()
        .collect()
}

pub fn registry_get(key: &str) -> Option<&ResourceEntry> {
    RESOURCE_REGISTRY.get(key)
}

pub fn registry_keys() -> Vec<String> {
    RESOURCE_REGISTRY.keys().cloned().collect()
}

pub fn assert_safe_sql_identifiers(cols: &[String]) -> Result<Vec<String>, String> {
    for c in cols {
        if !is_safe_sql_ident(c) {
            return Err(format!("Invalid SQL identifier: {c}"));
        }
    }
    Ok(cols.to_vec())
}

fn is_safe_sql_ident(c: &str) -> bool {
    let mut chars = c.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() && first != '_' {
        return false;
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn unique_preserve_order(cols: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for c in cols {
        if seen.insert(c.clone()) {
            out.push(c.clone());
        }
    }
    out
}

fn parse_fields_from_metadata(metadata: Option<&str>) -> Option<Vec<String>> {
    let raw = metadata?;
    let j: serde_json::Value = serde_json::from_str(raw).ok()?;
    let arr = j.get("fields")?.as_array()?;
    let mut out = Vec::new();
    for x in arr {
        let s = x.as_str()?.trim();
        if !s.is_empty() {
            out.push(s.to_string());
        }
    }
    if out.is_empty() {
        return None;
    }
    assert_safe_sql_identifiers(&out).ok()
}

fn parse_fields_from_v5(v5: Option<&str>) -> Option<Vec<String>> {
    let s = v5?.trim();
    if s.is_empty() {
        return None;
    }
    let parts: Vec<String> = s
        .split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    assert_safe_sql_identifiers(&parts).ok()
}

fn matches_resource(v2: Option<&str>, resource_key: &str) -> bool {
    let Some(v2) = v2 else {
        return false;
    };
    if v2 == resource_key {
        return true;
    }
    let Some(reg) = RESOURCE_REGISTRY.get(resource_key) else {
        return false;
    };
    reg.aliases.iter().any(|a| a == v2)
}

fn subject_matches(v0: Option<&str>, ctx: &FieldAccessContext) -> bool {
    let Some(v0) = v0 else {
        return false;
    };
    v0 == ctx.identity_hex || v0 == ctx.role_id.to_string() || v0 == ctx.role_name
}

/// `None` = full row access; `Some(cols)` = explicit snake_case columns.
pub(crate) fn resolve_read_columns(
    resource_key: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Option<Vec<String>>, String> {
    let Some(field_access) = field_access else {
        return Ok(None);
    };
    if field_access.is_superuser {
        return Ok(None);
    }
    if field_access.role_permissions.iter().any(|p| p == "*:*") {
        return Ok(None);
    }
    let Some(reg) = RESOURCE_REGISTRY.get(resource_key) else {
        return Err(format!("unknown resource key: {resource_key}"));
    };

    let org_str = field_access.organization_id.to_string();
    let mut saw_full_wildcard = false;
    let mut field_batches: Vec<Vec<String>> = Vec::new();

    for rule in &field_access.casbin_rules {
        if rule.ptype != "p" {
            continue;
        }
        if !subject_matches(rule.v0.as_deref(), field_access) {
            continue;
        }
        if rule.v1.as_deref() != Some(org_str.as_str()) {
            continue;
        }

        let v2 = rule.v2.clone().unwrap_or_default();
        let v3 = rule.v3.clone().unwrap_or_default();

        if v2 == "*" && (v3 == "*" || v3 == "read") {
            let deny = rule
                .v4
                .as_deref()
                .map(|s| s.eq_ignore_ascii_case("deny"))
                .unwrap_or(false);
            if !deny {
                saw_full_wildcard = true;
            }
            continue;
        }

        if !matches_resource(Some(&v2), resource_key) {
            continue;
        }
        if v3 != "read" && v3 != "*" {
            continue;
        }

        let fields = parse_fields_from_metadata(rule.metadata.as_deref())
            .or_else(|| parse_fields_from_v5(rule.v5.as_deref()));
        if let Some(f) = fields {
            if !f.is_empty() {
                field_batches.push(f);
            }
        }
    }

    if saw_full_wildcard {
        return Ok(None);
    }

    if !field_batches.is_empty() {
        let mut merged: Vec<String> = reg.mandatory.clone();
        merged.extend(field_batches.into_iter().flatten());
        let merged = unique_preserve_order(&merged);
        return Ok(Some(assert_safe_sql_identifiers(&merged)?));
    }

    let mut cols = reg.mandatory.clone();
    cols.extend_from_slice(&reg.default_restricted);
    Ok(Some(assert_safe_sql_identifiers(&cols)?))
}

pub fn resolve_http_sql_columns(
    resource_key: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<String>, String> {
    let restricted = resolve_read_columns(resource_key, field_access)?;
    let reg = RESOURCE_REGISTRY
        .get(resource_key)
        .ok_or_else(|| format!("unknown resource: {resource_key}"))?;
    let cols = if let Some(cols) = restricted {
        cols
    } else {
        let mut merged = reg.mandatory.clone();
        merged.extend_from_slice(&reg.default_restricted);
        assert_safe_sql_identifiers(&unique_preserve_order(&merged))?
    };
    assert_safe_sql_identifiers(&filter_http_sql_unsafe_columns(&cols, Some(resource_key)))
}

pub fn select_org_scoped_sql(
    resource_key: &str,
    table: &str,
    organization_id: u64,
    field_access: Option<&FieldAccessContext>,
    extra_where: &str,
    order_by: &str,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns(resource_key, field_access)?;
    let col_part = cols.join(", ");
    let where_clause = format!("organization_id = {organization_id}{extra_where}");
    Ok(format!(
        "SELECT {col_part} FROM {table} WHERE {where_clause}{order_by}"
    ))
}

pub fn select_company_scoped_sql(
    resource_key: &str,
    table: &str,
    company_id: u64,
    field_access: Option<&FieldAccessContext>,
    extra_where: &str,
    order_by: &str,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns(resource_key, field_access)?;
    let col_part = cols.join(", ");
    let where_clause = format!("company_id = {company_id}{extra_where}");
    Ok(format!(
        "SELECT {col_part} FROM {table} WHERE {where_clause}{order_by}"
    ))
}

pub fn select_roles_active_sql(
    field_access: Option<&FieldAccessContext>,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns("roles", field_access)?;
    let col_part = cols.join(", ");
    Ok(format!(
        "SELECT {col_part} FROM role WHERE is_active = true"
    ))
}

/// SpacetimeDB HTTP SQL: `Identity` must be `0x` + 64 hex, not a quoted UUID/string.
pub fn identity_sql_literal(hex64: &str) -> Result<String, String> {
    let s = hex64.trim();
    let s = s.strip_prefix("0x").unwrap_or(s);
    let s = s.strip_prefix("0X").unwrap_or(s);
    if s.len() != 64 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "invalid SpacetimeDB identity hex (expected 64 hex digits, got len {})",
            s.len()
        ));
    }
    Ok(format!("0x{}", s.to_ascii_lowercase()))
}

pub fn select_user_profile_by_identity_sql(
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns("user-profile", field_access)?;
    let col_part = cols.join(", ");
    let id = identity_sql_literal(identity_hex)?;
    Ok(format!(
        "SELECT {col_part} FROM user_profile WHERE identity = {id} LIMIT 1"
    ))
}

pub fn select_user_role_assignments_for_identity_sql(
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns("user-roles", field_access)?;
    let col_part = cols.join(", ");
    let id = identity_sql_literal(identity_hex)?;
    Ok(format!(
        "SELECT {col_part} FROM user_role_assignment WHERE user_identity = {id} AND is_active = true"
    ))
}

pub fn select_user_organization_for_identity_sql(
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns("user-organization", field_access)?;
    let col_part = cols.join(", ");
    let id = identity_sql_literal(identity_hex)?;
    Ok(format!(
        "SELECT {col_part} FROM user_organization WHERE user_identity = {id} AND is_active = true"
    ))
}

pub fn select_casbin_rules_in_subjects_sql(
    subjects_list_sql: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns("casbin-rule", field_access)?;
    let col_part = cols.join(", ");
    Ok(format!(
        "SELECT {col_part} FROM casbin_rule WHERE v0 IN ({subjects_list_sql})"
    ))
}

/// Column list for a generated row type name (see `stdb-generated-sql-columns.json`).
pub fn sql_column_list_for_generated_type(type_name: &str) -> Result<Vec<String>, String> {
    let from_schema = STDB_GENERATED_SQL_COLUMNS
        .get(type_name)
        .filter(|v| !v.is_empty());
    let Some(from_schema) = from_schema else {
        return Err(format!(
            "sql_column_list_for_generated_type: unknown type \"{type_name}\""
        ));
    };
    assert_safe_sql_identifiers(from_schema)
}
