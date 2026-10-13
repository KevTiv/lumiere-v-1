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
        "iot-actions".to_string(),
        ["payload", "result_payload", "error"]
            .into_iter()
            .map(String::from)
            .collect(),
    );
    m.insert(
        "iot-alerts".to_string(),
        ["resolved_by"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "iot-pairing-tokens".to_string(),
        ["created_by"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "iot-telemetry".to_string(),
        ["raw_value"].into_iter().map(String::from).collect(),
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

/// Per-resource columns allowed to survive global exclusions when selected by field policy.
static HTTP_SQL_INCLUDED_COLUMNS: Lazy<HashMap<String, HashSet<String>>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert(
        "account-moves".to_string(),
        ["metadata"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "mail-messages".to_string(),
        ["metadata"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "bank-statement-lines".to_string(),
        ["move_ids"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "dashboards".to_string(),
        ["widget_ids"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "product-attribute-lines".to_string(),
        ["value_ids"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "purchase-orders".to_string(),
        ["picking_ids", "invoice_ids"]
            .into_iter()
            .map(String::from)
            .collect(),
    );
    m.insert(
        "sale-orders".to_string(),
        ["picking_ids", "invoice_ids"]
            .into_iter()
            .map(String::from)
            .collect(),
    );
    // Exact COV-06/07 readbacks resolve effects through these owned relations.
    m.insert(
        "stock-pickings".to_string(),
        ["backorder_ids"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "mrp-productions".to_string(),
        ["move_raw_ids", "move_finished_ids", "workorder_ids"]
            .into_iter()
            .map(String::from)
            .collect(),
    );
    m.insert(
        "mrp-workorders".to_string(),
        ["time_ids"].into_iter().map(String::from).collect(),
    );
    m.insert(
        "mrp-workcenters".to_string(),
        ["order_ids", "productivity_ids"]
            .into_iter()
            .map(String::from)
            .collect(),
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

/// Return the module that owns a registered table, when module-level RBAC is
/// defined for that table family. Keeping this derived from the canonical
/// registry prevents HTTP and realtime authorization from disagreeing on
/// aliases such as `employees`/`hr_employee` and `iot-hubs`/`iot_hub`.
fn resource_module(resource_key: &str) -> Option<&'static str> {
    let table = registry_get(resource_key)
        .map(|entry| entry.table.as_str())
        .unwrap_or(resource_key);
    if table.starts_with("hr_") {
        Some("hr")
    } else if table.starts_with("iot_") {
        Some("iot")
    } else {
        None
    }
}

fn has_module_permission(access: &FieldAccessContext, module: &str, action: &str) -> bool {
    let exact = format!("module:{module}:{action}");
    let wildcard = format!("module:{module}:*");
    access
        .role_permissions
        .iter()
        .any(|permission| permission == &exact || permission == &wildcard)
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

pub fn has_resource_read_permission(
    field_access: Option<&FieldAccessContext>,
    resource_key: &str,
) -> bool {
    let Some(access) = field_access else {
        return false;
    };
    if access.is_superuser
        || access
            .role_permissions
            .iter()
            .any(|permission| permission == "*:*")
    {
        return true;
    }
    let Some(resource) = registry_get(resource_key) else {
        return false;
    };
    if resource_module(resource_key)
        .is_some_and(|module| has_module_permission(access, module, "read"))
    {
        return true;
    }

    access.role_permissions.iter().any(|permission| {
        let Some((configured_resource, action)) = permission.rsplit_once(':') else {
            return false;
        };
        if action != "read" && action != "*" {
            return false;
        }
        field_resource_matches(configured_resource, resource_key)
            || resource.aliases.iter().any(|alias| {
                alias == configured_resource
                    || alias.replace('-', "_") == configured_resource.replace('-', "_")
            })
    })
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
    if action == "read"
        && resource_module(resource).is_some_and(|module| has_module_permission(fa, module, "read"))
    {
        return true;
    }
    if resource_module(resource).is_some_and(|module| has_module_permission(fa, module, "*")) {
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
        let mut cols = strip_hr_pin(cols);
        if resource_key == "hr-statutory-ids" {
            cols.retain(|c| c != HR_STATUTORY_ID_VALUE);
        }
        return Ok(cols);
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
        // A purpose grant must not widen an explicit field selection.
        let has_field_selection = fa.field_permissions.iter().any(|rule| {
            rule.action.eq_ignore_ascii_case("read")
                && field_permission_applies(rule, fa)
                && field_resource_matches(&rule.resource, resource_key)
                && !rule.allowed_fields.is_empty()
                && assert_safe_sql_identifiers(&rule.allowed_fields).is_ok()
        });
        if !has_field_selection || out.iter().any(|c| c == HR_STATUTORY_ID_VALUE) {
            out.push(HR_STATUTORY_ID_VALUE.to_string());
        }
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
    if resource_key == "hr-statutory-ids" && set.contains(HR_STATUTORY_ID_VALUE) {
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
            | "hr-statutory-ids"
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
    let mut cols = apply_hr_field_policy(resource_key, cols, field_access)?;
    // The v0.3.4 registry projection predates the landed-cost lifecycle UI.
    // State is a non-sensitive operational field required for action gating
    // and authoritative lifecycle reads.
    if resource_key == "landed-costs" && !cols.iter().any(|column| column == "state") {
        cols.push("state".to_string());
    }
    // `company_id` is an authorization scope column, not an optional business
    // field. Keep it in custom projections whenever the canonical default
    // projection exposes it so api-server post-filters can verify SQL scope.
    let company_id_is_scope_metadata = reg
        .mandatory
        .iter()
        .chain(reg.default_restricted.iter())
        .any(|column| column == "company_id");
    if company_id_is_scope_metadata && !cols.iter().any(|column| column == "company_id") {
        cols.push("company_id".to_string());
    }
    if matches!(
        resource_key,
        "iot-actions"
            | "iot-alerts"
            | "iot-devices"
            | "iot-hubs"
            | "iot-pairing-tokens"
            | "iot-telemetry"
            | "iot-thresholds"
    ) && !cols.iter().any(|column| column == "company_id")
    {
        cols.push("company_id".to_string());
    }
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

pub fn select_user_profile_for_organization_sql(
    identity_hex: &str,
    organization_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<String, String> {
    let cols = resolve_http_sql_columns("user-profile", field_access)?;
    let col_part = cols.join(", ");
    let id = identity_sql_literal(identity_hex)?;
    Ok(format!(
        "SELECT {col_part} FROM user_profile WHERE identity = {id} AND organization_id = {organization_id} LIMIT 1"
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

    fn field_access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 7,
            role_id: 9,
            role_name: "member".into(),
            is_superuser: false,
            role_permissions: permissions
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            identity_hex: "actor".into(),
            field_permissions: Vec::new(),
        }
    }

    fn select_fields(access: &mut FieldAccessContext, resource: &str, fields: &[&str]) {
        access.field_permissions.push(FieldPermissionLike {
            id: Some(1),
            organization_id: Some(access.organization_id),
            role_id: Some(access.role_id),
            resource: resource.to_string(),
            action: "read".to_string(),
            allowed_fields: fields.iter().map(|field| (*field).to_string()).collect(),
            subject_user_hex: None,
            subject_role_id: Some(access.role_id),
        });
    }

    #[test]
    fn pass12_statement_projections_include_schema_backed_mapper_fields() {
        let restricted = field_access(&["financial_report:read"]);
        let mut superuser = field_access(&[]);
        superuser.is_superuser = true;
        let wildcard = field_access(&["*:*"]);
        for resource in [
            "profit-loss-lines",
            "balance-sheet-lines",
            "cash-flow-lines",
        ] {
            for access in [None, Some(&restricted), Some(&superuser), Some(&wildcard)] {
                let cols = resolve_http_sql_columns(resource, access).expect("statement columns");
                for field in [
                    "id",
                    "organization_id",
                    "company_id",
                    "report_id",
                    "sequence",
                    "name",
                    "line_type",
                    "parent_id",
                    "level",
                    "is_leaf",
                    "amount",
                    "comparison_amount",
                    "variance",
                    "variance_percentage",
                    "currency_id",
                ] {
                    assert!(
                        cols.iter().any(|col| col == field),
                        "{resource}: missing {field}"
                    );
                }
                assert_eq!(cols.len(), cols.iter().collect::<HashSet<_>>().len());
                assert!(!cols.iter().any(|col| col == "metadata"));
                assert_eq!(
                    cols.iter().any(|col| col == "account_id"),
                    resource != "cash-flow-lines"
                );
            }
        }
    }

    #[test]
    fn pass12_statement_field_selections_keep_scope_without_widening_display_fields() {
        for resource in [
            "profit-loss-lines",
            "balance-sheet-lines",
            "cash-flow-lines",
        ] {
            let mut access = field_access(&["financial_report:read"]);
            select_fields(&mut access, resource, &["name"]);
            let cols = resolve_http_sql_columns(resource, Some(&access)).expect("selected columns");
            let expected: HashSet<&str> =
                ["id", "organization_id", "company_id", "report_id", "name"]
                    .into_iter()
                    .collect();
            assert_eq!(
                cols.iter().map(String::as_str).collect::<HashSet<_>>(),
                expected,
                "{resource}"
            );
        }
    }

    #[test]
    fn pass12_product_attribute_values_are_opted_in_not_forced_into_field_selections() {
        let restricted = field_access(&["product:read"]);
        let mut superuser = field_access(&[]);
        superuser.is_superuser = true;
        for access in [None, Some(&restricted), Some(&superuser)] {
            let cols = resolve_http_sql_columns("product-attribute-lines", access)
                .expect("attribute columns");
            assert!(cols.iter().any(|col| col == "value_ids"));
        }
        let mut access = restricted;
        select_fields(&mut access, "product-attribute-lines", &["attribute_id"]);
        let cols = resolve_http_sql_columns("product-attribute-lines", Some(&access)).unwrap();
        assert!(!cols.iter().any(|col| col == "value_ids"));
        access.field_permissions.clear();
        select_fields(
            &mut access,
            "product-attribute-lines",
            &["value_ids", "metadata", "tag_ids"],
        );
        let cols = resolve_http_sql_columns("product-attribute-lines", Some(&access)).unwrap();
        assert!(cols.iter().any(|col| col == "value_ids"));
        assert!(!cols.iter().any(|col| col == "metadata" || col == "tag_ids"));
        assert!(
            filter_http_sql_unsafe_columns(&["value_ids".to_string()], Some("products")).is_empty()
        );
    }

    #[test]
    fn pass12_child_field_selections_preserve_only_required_scope_and_selected_fields() {
        for (resource, scope, selected, masked) in [
            (
                "bank-statement-import-lines",
                &["import_id"][..],
                "reference",
                "amount",
            ),
            (
                "tax-deadline-reminders",
                &["tax_deadline_id"][..],
                "status",
                "user_id",
            ),
            (
                "consolidation-company-rates",
                &["company_id"][..],
                "rate_type",
                "exchange_rate",
            ),
            (
                "hr-leave-allocations",
                &["company_id", "employee_id"][..],
                "period_year",
                "allocated_days",
            ),
            (
                "hr-offboarding-checklists",
                &["company_id", "employee_id"][..],
                "status",
                "assets_notes",
            ),
            (
                "hr-statutory-ids",
                &["company_id", "employee_id"][..],
                "id_kind",
                "value",
            ),
            (
                "document-versions",
                &["document_id"][..],
                "version_number",
                "url",
            ),
            (
                "document-external-refs",
                &["document_id"][..],
                "provider",
                "external_id",
            ),
            (
                "document-legal-holds",
                &["document_id"][..],
                "is_active",
                "reason",
            ),
            (
                "document-signature-requests",
                &["company_id", "document_id"][..],
                "status",
                "external_envelope_id",
            ),
        ] {
            let mut access = field_access(&[&format!("{resource}:read")]);
            select_fields(&mut access, resource, &[selected]);
            let cols = resolve_http_sql_columns(resource, Some(&access)).expect("child columns");
            let expected: HashSet<&str> = ["id", "organization_id", selected]
                .into_iter()
                .chain(scope.iter().copied())
                .collect();
            assert_eq!(
                cols.iter().map(String::as_str).collect::<HashSet<_>>(),
                expected,
                "{resource}"
            );
            assert!(
                !cols.iter().any(|col| col == masked),
                "{resource}: exposed {masked}"
            );
        }
    }

    #[test]
    fn pass12_accounting_child_defaults_include_mapper_fields_and_real_parent_scope() {
        let mut superuser = field_access(&[]);
        superuser.is_superuser = true;
        let restricted = field_access(&["module:accounting:read"]);
        for access in [None, Some(&restricted), Some(&superuser)] {
            for (resource, fields) in [
                (
                    "bank-statement-import-lines",
                    &[
                        "import_id",
                        "row_number",
                        "date",
                        "amount",
                        "reference",
                        "description",
                        "validation_error",
                        "created_statement_line_id",
                    ][..],
                ),
                (
                    "tax-deadline-reminders",
                    &[
                        "tax_deadline_id",
                        "reminder_date",
                        "days_before_deadline",
                        "notification_type",
                        "status",
                        "sent_at",
                        "acknowledged_at",
                    ][..],
                ),
                (
                    "consolidation-company-rates",
                    &[
                        "company_id",
                        "period_id",
                        "currency_id",
                        "exchange_rate",
                        "rate_type",
                        "effective_date",
                    ][..],
                ),
            ] {
                let cols =
                    resolve_http_sql_columns(resource, access).expect("accounting child columns");
                for field in fields {
                    assert!(
                        cols.iter().any(|col| col == *field),
                        "{resource}: missing {field}"
                    );
                }
                if resource != "consolidation-company-rates" {
                    assert!(
                        !cols.iter().any(|col| col == "company_id"),
                        "{resource} has parent-derived company scope"
                    );
                }
            }
        }
    }

    #[test]
    fn statutory_id_value_requires_sensitive_permission_and_respects_field_selection() {
        let resource = "hr-statutory-ids";
        for permissions in [
            &["hr_employee:read"][..],
            &["module:hr:read"][..],
            &["hr_employee:view_pii"][..],
            &["hr_employee:update"][..],
        ] {
            let mut access = field_access(permissions);
            select_fields(&mut access, resource, &["id_kind", "value"]);
            let cols = resolve_http_sql_columns(resource, Some(&access)).unwrap();
            assert!(!cols.iter().any(|col| col == "value"));
            assert!(!hr_fields_require_read_audit(resource, &cols));
        }
        let mut access = field_access(&["hr_employee:read", "hr_employee:view_statutory_id"]);
        let cols = resolve_http_sql_columns(resource, Some(&access)).unwrap();
        assert!(cols.iter().any(|col| col == "value"));
        assert!(is_hr_pii_resource(resource));
        assert!(hr_fields_require_read_audit(resource, &cols));
        select_fields(&mut access, resource, &["id_kind"]);
        let cols = resolve_http_sql_columns(resource, Some(&access)).unwrap();
        assert!(!cols.iter().any(|col| col == "value"));
        access.field_permissions.clear();
        select_fields(&mut access, resource, &["value"]);
        let cols = resolve_http_sql_columns(resource, Some(&access)).unwrap();
        assert_eq!(cols.iter().filter(|col| *col == "value").count(), 1);
        assert!(hr_fields_require_read_audit(resource, &cols));
    }

    #[test]
    fn statutory_id_audit_tracks_authorized_disclosure_not_metadata_or_unrelated_values() {
        let resource = "hr-statutory-ids";
        let input = vec!["id_kind".to_string(), "value".to_string()];
        let cols = apply_hr_field_policy(resource, input.clone(), None).unwrap();
        assert_eq!(cols, vec!["id_kind".to_string()]);
        assert!(!hr_fields_require_read_audit(resource, &cols));
        let mut superuser = field_access(&[]);
        superuser.is_superuser = true;
        for access in [&superuser, &field_access(&["*:*"])] {
            let cols = apply_hr_field_policy(resource, input.clone(), Some(access)).unwrap();
            assert!(cols.iter().any(|col| col == "value"));
            assert!(hr_fields_require_read_audit(resource, &cols));
        }
        assert!(!hr_fields_require_read_audit(
            "products",
            &["value".to_string()]
        ));
    }

    #[test]
    fn sensitive_hr_field_selections_cannot_bypass_existing_pii_and_compensation_denials() {
        let mut access = field_access(&["module:hr:read"]);
        for (resource, fields) in [
            (
                "employees",
                &["gender", "birthday", "emergency_phone", "pin"][..],
            ),
            ("contracts", &["wage"][..]),
            ("payslips", &["basic_wage", "gross_wage", "net_wage"][..]),
        ] {
            access.field_permissions.clear();
            select_fields(&mut access, resource, fields);
            let cols = resolve_http_sql_columns(resource, Some(&access)).unwrap();
            assert!(fields
                .iter()
                .all(|field| !cols.iter().any(|col| col == *field)));
            assert!(!hr_fields_require_read_audit(resource, &cols));
            assert!(hr_fields_require_read_audit(
                resource,
                &fields
                    .iter()
                    .map(|field| (*field).to_string())
                    .collect::<Vec<_>>()
            ));
        }
    }

    #[test]
    fn user_profile_authority_query_is_scoped_to_identity_and_organization() {
        let identity = "ab".repeat(32);
        let sql = select_user_profile_for_organization_sql(&identity, 42, None)
            .expect("organization-scoped profile SQL");

        assert!(sql.contains(&format!("identity = 0x{identity}")));
        assert!(sql.contains("organization_id = 42"));
        assert!(sql.ends_with("LIMIT 1"));
    }

    #[test]
    fn resource_read_permission_accepts_alias_and_wildcards() {
        assert!(has_resource_read_permission(
            Some(&field_access(&["sale_order:read"])),
            "sale-orders"
        ));
        assert!(has_resource_read_permission(
            Some(&field_access(&["contacts:*"])),
            "contacts"
        ));
        assert!(has_resource_read_permission(
            Some(&field_access(&["*:*"])),
            "products"
        ));
    }

    #[test]
    fn resource_read_permission_accepts_canonical_module_grants() {
        assert!(has_resource_read_permission(
            Some(&field_access(&["module:iot:read"])),
            "iot-hubs"
        ));
        assert!(has_resource_read_permission(
            Some(&field_access(&["module:iot:*"])),
            "iot-devices"
        ));
        assert!(has_resource_read_permission(
            Some(&field_access(&["module:hr:read"])),
            "employees"
        ));
        assert!(!has_resource_read_permission(
            Some(&field_access(&["module:hr:read"])),
            "iot-hubs"
        ));
    }

    #[test]
    fn hr_module_read_grant_is_read_only_but_wildcard_covers_hr_actions() {
        let read = field_access(&["module:hr:read"]);
        assert!(has_hr_permission(Some(&read), "hr_employee", "read"));
        assert!(!has_hr_permission(Some(&read), "hr_employee", "create"));

        let wildcard = field_access(&["module:hr:*"]);
        assert!(has_hr_permission(Some(&wildcard), "hr_employee", "create"));
    }

    #[test]
    fn resource_read_permission_fails_closed() {
        assert!(!has_resource_read_permission(None, "contacts"));
        assert!(!has_resource_read_permission(
            Some(&field_access(&["contacts:write"])),
            "contacts"
        ));
        assert!(!has_resource_read_permission(
            Some(&field_access(&["contacts:read"])),
            "unknown-resource"
        ));
    }

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
    fn resolve_http_sql_columns_includes_workflow_links_for_account_moves() {
        let cols = resolve_http_sql_columns("account-moves", None).expect("account-moves columns");
        for field in ["metadata", "sale_order_id", "invoice_origin"] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in account-moves projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_message_idempotency_metadata() {
        let cols = resolve_http_sql_columns("mail-messages", None).expect("mail-messages columns");
        assert!(
            cols.iter().any(|column| column == "metadata"),
            "expected metadata in mail-messages projection, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_includes_bank_reconciliation_readback() {
        let cols = resolve_http_sql_columns("bank-statement-lines", None)
            .expect("bank-statement-lines columns");
        for field in ["move_ids", "amount_residual"] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in bank-statement-lines projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_exposes_payment_reconciliation_outcome() {
        let cols = resolve_http_sql_columns("payment-reconciliations", None)
            .expect("payment-reconciliations columns");
        for field in [
            "allocated_move_line_id",
            "allocated_amount",
            "residual_before",
            "residual_after",
            "write_off_amount",
            "write_off_account_id",
            "write_off_move_id",
        ] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in payment-reconciliations projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_invoice_readback_for_sale_orders() {
        let cols = resolve_http_sql_columns("sale-orders", None).expect("sale-orders columns");
        for field in ["invoice_ids", "invoice_count", "invoice_status"] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in sale-orders projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_invoice_readback_for_purchase_orders() {
        let cols =
            resolve_http_sql_columns("purchase-orders", None).expect("purchase-orders columns");
        for field in ["invoice_ids", "invoice_count", "invoice_status"] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in purchase-orders projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_cov06_cov07_relation_ids() {
        for (resource, fields) in [
            ("stock-pickings", &["backorder_ids"][..]),
            (
                "mrp-productions",
                &["move_raw_ids", "move_finished_ids", "workorder_ids"][..],
            ),
            ("mrp-workorders", &["time_ids"][..]),
            ("mrp-workcenters", &["order_ids", "productivity_ids"][..]),
        ] {
            let cols = resolve_http_sql_columns(resource, None).expect("columns");
            for field in fields {
                assert!(
                    cols.iter().any(|column| column == field),
                    "expected {field} in {resource} projection, got: {cols:?}"
                );
            }
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_location_and_lock_for_lots() {
        let cols = resolve_http_sql_columns("stock-production-lots", None)
            .expect("stock-production-lots columns");
        for field in ["location_id", "is_locked"] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in stock-production-lots projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_state_for_serials() {
        let cols = resolve_http_sql_columns("stock-production-serials", None)
            .expect("stock-production-serials columns");
        assert!(
            cols.iter().any(|column| column == "state"),
            "expected state in stock-production-serials projection, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_includes_qc_location_for_warehouses() {
        let cols = resolve_http_sql_columns("warehouses", None).expect("warehouses columns");
        assert!(
            cols.iter().any(|column| column == "wh_qc_stock_loc_id"),
            "expected wh_qc_stock_loc_id in warehouses projection, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_includes_availability_for_stock_quants() {
        let cols = resolve_http_sql_columns("stock-quants", None).expect("stock-quants columns");
        for field in ["quantity", "reserved_quantity", "available_quantity"] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in stock-quants projection, got: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_includes_ordered_quantity_for_stock_moves() {
        let cols = resolve_http_sql_columns("stock-moves", None).expect("stock-moves columns");
        assert!(
            cols.iter().any(|column| column == "product_uom_qty"),
            "expected product_uom_qty in stock-moves projection, got: {cols:?}"
        );
    }

    #[test]
    fn resolve_http_sql_columns_includes_backorder_identity_for_stock_pickings() {
        let cols =
            resolve_http_sql_columns("stock-pickings", None).expect("stock-pickings columns");
        assert!(
            cols.iter().any(|column| column == "backorder_id"),
            "expected backorder_id in stock-pickings projection, got: {cols:?}"
        );
    }

    #[test]
    fn selective_accounting_field_policies_keep_company_scope_metadata() {
        for resource in ["account-accounts", "account-journals", "account-taxes"] {
            let mut access = field_access(&[&format!("{resource}:read")]);
            access.field_permissions.push(FieldPermissionLike {
                id: Some(1),
                organization_id: Some(7),
                role_id: Some(9),
                resource: resource.to_string(),
                action: "read".to_string(),
                allowed_fields: vec!["name".to_string()],
                subject_user_hex: None,
                subject_role_id: Some(9),
            });

            let cols = resolve_http_sql_columns(resource, Some(&access))
                .expect("selective accounting columns");
            assert!(cols.iter().any(|column| column == "company_id"));
            assert!(cols.iter().any(|column| column == "id"));
            assert!(cols.iter().any(|column| column == "organization_id"));
            assert!(cols.iter().any(|column| column == "name"));
        }
    }

    #[test]
    fn resolve_http_sql_columns_exposes_helpdesk_lifecycle_without_customer_pii() {
        let cols =
            resolve_http_sql_columns("helpdesk-tickets", None).expect("helpdesk-tickets columns");
        for field in ["state", "priority"] {
            assert!(
                cols.iter().any(|column| column == field),
                "expected {field} in helpdesk-tickets projection, got: {cols:?}"
            );
        }
        for field in ["description", "partner_name", "partner_email", "user_id"] {
            assert!(
                !cols.iter().any(|column| column == field),
                "{field} must remain excluded from the default helpdesk projection: {cols:?}"
            );
        }
    }

    #[test]
    fn resolve_http_sql_columns_exposes_landed_cost_state() {
        let cols = resolve_http_sql_columns("landed-costs", None).expect("landed-costs columns");
        assert!(
            cols.iter().any(|column| column == "state"),
            "expected state in landed-costs projection, got: {cols:?}"
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

    #[test]
    fn iot_http_projections_include_scope_and_hard_exclude_sensitive_payloads() {
        for resource in [
            "iot-actions",
            "iot-alerts",
            "iot-devices",
            "iot-hubs",
            "iot-pairing-tokens",
            "iot-telemetry",
            "iot-thresholds",
        ] {
            let cols = resolve_http_sql_columns(resource, None).expect("IoT columns");
            assert!(
                cols.iter().any(|column| column == "company_id"),
                "{resource} must include company_id: {cols:?}"
            );
        }

        let action_cols = resolve_http_sql_columns("iot-actions", None).expect("action columns");
        for field in ["payload", "result_payload", "error"] {
            assert!(!action_cols.iter().any(|column| column == field));
        }
        let telemetry_cols =
            resolve_http_sql_columns("iot-telemetry", None).expect("telemetry columns");
        assert!(!telemetry_cols.iter().any(|column| column == "raw_value"));
        let alert_cols = resolve_http_sql_columns("iot-alerts", None).expect("alert columns");
        assert!(!alert_cols.iter().any(|column| column == "resolved_by"));
        let pairing_cols =
            resolve_http_sql_columns("iot-pairing-tokens", None).expect("pairing columns");
        assert!(!pairing_cols.iter().any(|column| column == "created_by"));
        assert!(
            pairing_cols.iter().any(|column| column == "token"),
            "the current operator pairing flow reads the newly generated token"
        );
    }
}
