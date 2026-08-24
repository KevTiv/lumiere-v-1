//! SQL column resolution and org/company-scoped query builders.
//!
//! Registry keys and column metadata: `resource_registry` + `assets/resource_registry.json`.
//! Run `make codegen` after editing the registry to refresh TypeScript.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::resource_registry::registry_get;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldAccessContext {
    pub organization_id: u64,
    pub role_id: u64,
    pub role_name: String,
    pub is_superuser: bool,
    pub role_permissions: Vec<String>,
    pub identity_hex: String,
    pub field_permissions: Vec<FieldPermissionLike>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldPermissionLike {
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(default)]
    pub organization_id: Option<u64>,
    #[serde(default)]
    pub role_id: Option<u64>,
    #[serde(default)]
    pub resource: String,
    /// `"read"` or `"write"`
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub allowed_fields: Vec<String>,
    /// When subject is a user, identity hex; otherwise empty.
    #[serde(default)]
    pub subject_user_hex: Option<String>,
    /// When subject is a role, role id as string.
    #[serde(default)]
    pub subject_role_id: Option<u64>,
}

static STDB_GENERATED_SQL_COLUMNS: Lazy<HashMap<String, Vec<String>>> = Lazy::new(|| {
    serde_json::from_str(lumiere_contracts::manifests::STDB_GENERATED_SQL_COLUMNS)
        .expect("stdb-generated-sql-columns.json")
});

static HTTP_SQL_EXCLUDED_COLUMNS: Lazy<HashMap<String, HashSet<String>>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert(
        "activities".to_string(),
        [
            "user_id",
            "assigned_to",
            "created_by",
            "date_deadline",
            "date_done",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
    );
    m.insert(
        "contact-segments".to_string(),
        ["domain"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "opportunity-stages".to_string(),
        ["requirements"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "roles".to_string(),
        ["permissions"].into_iter().map(String::from).collect(),
    );
    m
});

/// Globally stripped from HTTP SQL unless a resource explicitly opts in via `HTTP_SQL_INCLUDED_COLUMNS`.
static GLOBAL_HTTP_SQL_EXCLUDED_COLUMNS: Lazy<HashSet<String>> = Lazy::new(|| {
    [
        "metadata",
        "create_uid",
        "write_uid",
        "create_date",
        "write_date",
        "created_at",
        "updated_at",
        "message_follower_ids",
        "message_ids",
        "activity_ids",
        "tag_ids",
    ]
    .into_iter()
    .map(String::from)
    .collect()
});

/// Per-resource columns that must be selected even when listed in `GLOBAL_HTTP_SQL_EXCLUDED_COLUMNS`.
static HTTP_SQL_INCLUDED_COLUMNS: Lazy<HashMap<String, HashSet<String>>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert(
        "account-moves".to_string(),
        ["metadata"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "dashboards".to_string(),
        ["widget_ids"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "purchase-orders".to_string(),
        ["picking_ids"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "sale-orders".to_string(),
        ["picking_ids"].into_iter().map(String::from).collect(),
    );
    m
});

fn filter_http_sql_unsafe_columns(cols: &[String], resource_key: Option<&str>) -> Vec<String> {
    let resource_excluded = resource_key.and_then(|k| HTTP_SQL_EXCLUDED_COLUMNS.get(k));
    let resource_included = resource_key.and_then(|k| HTTP_SQL_INCLUDED_COLUMNS.get(k));
    cols.iter()
        .filter(|col| {
            if resource_included.is_some_and(|inc| inc.contains(*col)) {
                return true;
            }
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

fn field_resource_matches(configured: &str, resource_key: &str) -> bool {
    if configured == "*" || configured == resource_key {
        return true;
    }
    let configured_norm = configured.replace('-', "_");
    let resource_norm = resource_key.replace('-', "_");
    if configured_norm == resource_norm {
        return true;
    }
    let Some(reg) = registry_get(resource_key) else {
        return false;
    };
    reg.aliases
        .iter()
        .any(|a| a == configured || a.replace('-', "_") == configured_norm)
}

fn field_permission_applies(rule: &FieldPermissionLike, ctx: &FieldAccessContext) -> bool {
    if let Some(role_id) = rule.subject_role_id {
        if role_id == ctx.role_id {
            return true;
        }
    }
    if let Some(user_hex) = rule.subject_user_hex.as_deref() {
        if user_hex == ctx.identity_hex {
            return true;
        }
    }
    // Fallback: denormalized role_id column.
    rule.role_id == Some(ctx.role_id)
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
    let Some(reg) = registry_get(resource_key) else {
        return Err(format!("unknown resource key: {resource_key}"));
    };

    let mut field_batches: Vec<Vec<String>> = Vec::new();

    for rule in &field_access.field_permissions {
        let action = rule.action.to_ascii_lowercase();
        if action != "read" {
            continue;
        }
        if !field_permission_applies(rule, field_access) {
            continue;
        }
        if !field_resource_matches(&rule.resource, resource_key) {
            continue;
        }
        if rule.allowed_fields.is_empty() {
            continue;
        }
        if let Ok(safe) = assert_safe_sql_identifiers(&rule.allowed_fields) {
            field_batches.push(safe);
        }
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

const HR_EMPLOYEE_SENSITIVE: &[&str] = &[
    "gender",
    "birthday",
    "marital",
    "emergency_contact",
    "emergency_phone",
    "barcode",
];
const HR_EMPLOYEE_PIN: &str = "pin";
const HR_CONTRACT_COMP: &[&str] = &["wage"];
const HR_PAYSLIP_COMP: &[&str] = &["basic_wage", "gross_wage", "net_wage"];
const HR_STATUTORY_ID_VALUE: &str = "value";

pub fn has_hr_permission(
    field_access: Option<&FieldAccessContext>,
    resource: &str,
    action: &str,
) -> bool {
    let Some(fa) = field_access else {
        return false;
    };
    if fa.is_superuser {
        return true;
    }
    let perm = format!("{resource}:{action}");
    let wildcard = format!("{resource}:*");
    fa.role_permissions
        .iter()
        .any(|p| p == "*:*" || p == &perm || p == &wildcard)
}

/// Strip `pin` from broad feeds; gate wages behind `view_comp`; sensitive PII behind purpose/resource.
pub fn apply_hr_field_policy(
    resource_key: &str,
    cols: Vec<String>,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<String>, String> {
    let Some(fa) = field_access else {
        return Ok(strip_hr_pin(cols));
    };
    if fa.is_superuser || fa.role_permissions.iter().any(|p| p == "*:*") {
        return Ok(cols);
    }

    let mut out: Vec<String> = cols.into_iter().filter(|c| c != HR_EMPLOYEE_PIN).collect();

    if resource_key == "employees" {
        out.retain(|c| !HR_EMPLOYEE_SENSITIVE.contains(&c.as_str()));
    }

    if resource_key == "my-employee" {
        if has_hr_permission(Some(fa), "hr_employee", "view_pii") {
            out.extend(HR_EMPLOYEE_SENSITIVE.iter().map(|s| (*s).to_string()));
            out.push(HR_EMPLOYEE_PIN.to_string());
        }
    }

    if resource_key == "direct-reports" {
        out.retain(|c| !HR_EMPLOYEE_SENSITIVE.contains(&c.as_str()));
    }

    if resource_key == "contracts" && has_hr_permission(Some(fa), "hr_contract", "view_comp") {
        out.extend(HR_CONTRACT_COMP.iter().map(|s| (*s).to_string()));
    } else if resource_key == "contracts" {
        out.retain(|c| !HR_CONTRACT_COMP.contains(&c.as_str()));
    }

    if resource_key == "payslips" && has_hr_permission(Some(fa), "hr_payroll", "view_comp") {
        out.extend(HR_PAYSLIP_COMP.iter().map(|s| (*s).to_string()));
    } else if resource_key == "payslips" {
        out.retain(|c| !HR_PAYSLIP_COMP.contains(&c.as_str()));
    }

    if resource_key == "hr-statutory-ids"
        && has_hr_permission(Some(fa), "hr_employee", "view_statutory_id")
    {
        out.push(HR_STATUTORY_ID_VALUE.to_string());
    } else if resource_key == "hr-statutory-ids" {
        out.retain(|c| c != HR_STATUTORY_ID_VALUE);
    }

    Ok(unique_preserve_order(&out))
}

fn strip_hr_pin(cols: Vec<String>) -> Vec<String> {
    cols.into_iter().filter(|c| c != HR_EMPLOYEE_PIN).collect()
}

pub fn purpose_for_hr_resource(resource_key: &str) -> &'static str {
    match resource_key {
        "my-employee" => "hr_self",
        "direct-reports" => "hr_manager",
        _ => "hr_admin",
    }
}

pub fn hr_fields_require_read_audit(resource_key: &str, fields: &[String]) -> bool {
    let set: std::collections::HashSet<&str> = fields.iter().map(String::as_str).collect();
    if set.contains(HR_EMPLOYEE_PIN) {
        return true;
    }
    if HR_EMPLOYEE_SENSITIVE.iter().any(|c| set.contains(*c)) {
        return true;
    }
    if resource_key == "contracts" && HR_CONTRACT_COMP.iter().any(|c| set.contains(*c)) {
        return true;
    }
    if resource_key == "payslips" && HR_PAYSLIP_COMP.iter().any(|c| set.contains(*c)) {
        return true;
    }
    false
}

pub fn is_hr_pii_resource(resource_key: &str) -> bool {
    matches!(
        resource_key,
        "employees"
            | "my-employee"
            | "direct-reports"
            | "contracts"
            | "payslips"
            | "employee-documents"
    )
}

pub fn resolve_http_sql_columns(
    resource_key: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<String>, String> {
    let restricted = resolve_read_columns(resource_key, field_access)?;
    let reg =
        registry_get(resource_key).ok_or_else(|| format!("unknown resource: {resource_key}"))?;
    let cols = if let Some(cols) = restricted {
        cols
    } else {
        let mut merged = reg.mandatory.clone();
        merged.extend_from_slice(&reg.default_restricted);
        assert_safe_sql_identifiers(&unique_preserve_order(&merged))?
    };
    let cols = apply_hr_field_policy(resource_key, cols, field_access)?;
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

/// Scope by both `organization_id` and `company_id`. Use for tables that carry
/// both fields and where company-private rows must never be visible across
/// company boundaries within the same organization.
pub fn select_org_and_company_scoped_sql(
    resource_key: &str,
    table: &str,
    organization_id: u64,
    company_id: u64,
    field_access: Option<&FieldAccessContext>,
    extra_where: &str,
    order_by: &str,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns(resource_key, field_access)?;
    let col_part = cols.join(", ");
    let where_clause =
        format!("organization_id = {organization_id} AND company_id = {company_id}{extra_where}");
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

pub fn select_field_permissions_for_org_sql(organization_id: u64) -> Result<String, String> {
    Ok(format!(
        "SELECT id, organization_id, subject, role_id, resource, action, allowed_fields, created_by, created_at FROM field_permission WHERE organization_id = {organization_id}"
    ))
}

/// Build `col = id1 OR col = id2` — SpacetimeDB SQL does not support `IN (...)`.
pub fn company_ids_equality_or_clause(column: &str, ids: &[u64]) -> Result<String, String> {
    assert_safe_sql_identifiers(&[column.to_string()])?;
    if ids.is_empty() {
        return Err("company_ids_equality_or_clause: empty ids".into());
    }
    Ok(ids
        .iter()
        .map(|id| format!("{column} = {id}"))
        .collect::<Vec<_>>()
        .join(" OR "))
}

/// Match rows where either `col_a` or `col_b` equals one of the company ids.
pub fn company_ids_dual_field_or_clause(
    col_a: &str,
    col_b: &str,
    ids: &[u64],
) -> Result<String, String> {
    let a = company_ids_equality_or_clause(col_a, ids)?;
    let b = company_ids_equality_or_clause(col_b, ids)?;
    Ok(format!("({a}) OR ({b})"))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_http_sql_columns_includes_deleted_at_for_leads() {
        let cols = resolve_http_sql_columns("leads", None).expect("leads columns");
        assert!(
            cols.iter().any(|c| c == "deleted_at"),
            "expected deleted_at in leads projection, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_includes_deleted_at_for_product_categories() {
        let cols = resolve_http_sql_columns("product-categories", None)
            .expect("product-categories columns");
        assert!(
            cols.iter().any(|c| c == "deleted_at"),
            "expected deleted_at in product-categories projection, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_includes_qty_fields_for_purchase_order_lines() {
        let cols = resolve_http_sql_columns("purchase-order-lines", None)
            .expect("purchase-order-lines columns");
        for field in ["qty_received", "qty_invoiced", "qty_to_invoice"] {
            assert!(
                cols.iter().any(|c| c == field),
                "expected {field} in purchase-order-lines projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_metadata_for_account_moves() {
        let cols = resolve_http_sql_columns("account-moves", None).expect("account-moves columns");
        assert!(
            cols.iter().any(|c| c == "metadata"),
            "expected metadata in account-moves projection, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_excludes_requirements_for_opportunity_stages() {
        let cols = resolve_http_sql_columns("opportunity-stages", None)
            .expect("opportunity-stages columns");
        assert!(
            !cols.iter().any(|c| c == "requirements"),
            "requirements must be excluded from HTTP SQL, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_excludes_domain_for_contact_segments() {
        let cols =
            resolve_http_sql_columns("contact-segments", None).expect("contact-segments columns");
        assert!(
            !cols.iter().any(|c| c == "domain"),
            "domain must be excluded from HTTP SQL, got: {cols:?}"
        );
    }
}
