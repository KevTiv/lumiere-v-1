use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::{
    has_hr_permission, has_resource_read_permission, hr_fields_require_read_audit,
    identity_sql_literal, is_hr_pii_resource, purpose_for_hr_resource, resolve_http_sql_columns,
    FieldAccessContext,
};
use stdb_client::StdbClient;

use super::company_scope::resolve_membership_company_id;
use super::row_values::{row_id_u64_strict, row_identity_option_is, row_u64};

fn hr_child_table(resource: &str) -> Option<&'static str> {
    match resource {
        "hr-leave-allocations" => Some("hr_leave_allocation"),
        "hr-offboarding-checklists" => Some("hr_offboarding_checklist"),
        "hr-statutory-ids" => Some("hr_statutory_id"),
        _ => None,
    }
}

/// Child resources reuse the domain read grants used by the HR workspace.
/// Create/update and `view_statutory_id` alone do not grant a resource read.
pub(super) fn has_hr_child_read_permission(
    fa: Option<&FieldAccessContext>,
    resource: &str,
) -> bool {
    let (alias, permission) = match resource {
        "hr-leave-allocations" => ("leave-requests", "hr_leave"),
        "hr-offboarding-checklists" | "hr-statutory-ids" => ("employees", "hr_employee"),
        _ => return false,
    };
    has_resource_read_permission(fa, resource)
        || has_resource_read_permission(fa, alias)
        || has_hr_permission(fa, permission, "read")
}

fn hr_child_can_list_all_employees(fa: Option<&FieldAccessContext>) -> bool {
    // Match read_employees' ownership rule, including registry spelling aliases.
    has_resource_read_permission(fa, "employees")
        || has_hr_permission(fa, "hr_employee", "read")
        || has_hr_permission(fa, "hr_employee", "create")
        || has_hr_permission(fa, "hr_employee", "update")
        || has_hr_permission(fa, "hr_employee", "view_pii")
}

fn hr_row_in_scope(row: &Value, organization_id: u64, company_id: u64) -> bool {
    matches!(row_u64(row, "organizationId", "organization_id"), Ok(Some(id)) if id == organization_id)
        && matches!(row_u64(row, "companyId", "company_id"), Ok(Some(id)) if id == company_id)
}

fn hr_child_employee_id(row: &Value) -> Option<u64> {
    row_u64(row, "employeeId", "employee_id")
        .ok()
        .flatten()
        .filter(|id| *id > 0)
}

fn hr_visible_employee_ids(
    rows: &[Value],
    organization_id: u64,
    company_id: u64,
    identity_hex: &str,
    fa: Option<&FieldAccessContext>,
) -> HashSet<u64> {
    let can_list_all = hr_child_can_list_all_employees(fa);
    let target = identity_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    rows.iter()
        .filter(|row| hr_row_in_scope(row, organization_id, company_id))
        .filter(|row| can_list_all || row_identity_option_is(row, "userId", "user_id", target))
        .filter_map(|row| row_id_u64_strict(row).ok().filter(|id| *id > 0))
        .collect()
}

fn filter_hr_child_rows(
    rows: &mut Vec<Value>,
    organization_id: u64,
    company_id: u64,
    employee_ids: &HashSet<u64>,
) {
    rows.retain(|row| {
        hr_row_in_scope(row, organization_id, company_id)
            && hr_child_employee_id(row).is_some_and(|id| employee_ids.contains(&id))
    });
}

fn hr_employee_parent_sql(organization_id: u64, company_id: u64, employee_ids: &[u64]) -> String {
    let ids = employee_ids
        .iter()
        .map(|id| format!("id = {id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!(
        "SELECT id, organization_id, company_id, user_id FROM hr_employee WHERE organization_id = {organization_id} AND company_id = {company_id} AND ({ids})"
    )
}

fn hr_child_audit_args(
    organization_id: u64,
    company_id: u64,
    resource: &str,
    table_name: &str,
    columns: &[String],
    rows: &[Value],
) -> Result<Value, ApiError> {
    let row_count = u32::try_from(rows.len())
        .map_err(|_| ApiError::Internal("Too many HR rows to audit".into()))?;
    let record_id = if rows.len() == 1 {
        row_id_u64_strict(&rows[0]).map_err(ApiError::Internal)?
    } else {
        0
    };
    Ok(serde_json::json!([organization_id, {
        "company_id": {"some": company_id},
        "purpose": purpose_for_hr_resource(resource),
        "resource_key": resource,
        "table_name": table_name,
        "record_id": record_id,
        "fields_accessed": columns,
        "row_count": row_count,
    }]))
}

/// Authorized child read for the three employee-linked HR workspace resources.
/// Browser company selection is intent, not authority. Parent lookups are bounded
/// to 100 referenced IDs per query and use supported equality/OR SQL, not subqueries
/// or comparisons against Option<Identity>. Missing or out-of-scope parents never
/// authorize a child; history is not hidden just because an employee is inactive.
pub(super) async fn read_hr_child_rows(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    fa: Option<&FieldAccessContext>,
    requested_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let table = hr_child_table(resource)
        .ok_or_else(|| ApiError::Forbidden("Unknown HR child resource".into()))?;
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let context_matches = fa.is_some_and(|access| {
        access.organization_id == organization_id
            && identity_sql_literal(&access.identity_hex).ok().as_ref() == Some(&identity)
    });
    if !context_matches || !has_hr_child_read_permission(fa, resource) {
        return Err(ApiError::Forbidden(format!(
            "Read permission denied for HR resource '{resource}'"
        )));
    }
    let company_id = resolve_membership_company_id(
        client,
        organization_id,
        identity_hex,
        requested_company_id,
        "Cannot query another company's HR data",
    )
    .await?;
    let columns = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
    let mut fetch_columns = columns.clone();
    let mut internal_columns = Vec::new();
    for (snake, camel) in [
        ("organization_id", "organizationId"),
        ("company_id", "companyId"),
        ("employee_id", "employeeId"),
    ] {
        if !fetch_columns.iter().any(|column| column == snake) {
            fetch_columns.push(snake.to_string());
            internal_columns.push((snake, camel));
        }
    }
    let sql = format!(
        "SELECT {} FROM {table} WHERE organization_id = {organization_id} AND company_id = {company_id}",
        fetch_columns.join(", ")
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    let mut employee_ids: Vec<u64> = rows
        .iter()
        .filter(|row| hr_row_in_scope(row, organization_id, company_id))
        .filter_map(hr_child_employee_id)
        .collect();
    employee_ids.sort_unstable();
    employee_ids.dedup();
    let mut visible = HashSet::new();
    for ids in employee_ids.chunks(100) {
        let parents = client
            .query_sql(&hr_employee_parent_sql(organization_id, company_id, ids))
            .await
            .map_err(ApiError::internal)?;
        visible.extend(hr_visible_employee_ids(
            &parents,
            organization_id,
            company_id,
            identity_hex,
            fa,
        ));
    }
    filter_hr_child_rows(&mut rows, organization_id, company_id, &visible);
    for row in &mut rows {
        if let Value::Object(fields) = row {
            for (snake, camel) in &internal_columns {
                fields.remove(*snake);
                fields.remove(*camel);
            }
        }
    }
    // Do not depend on the audit-classification registry rollout to protect the
    // statutory value. Audit only rows actually returned, without logging values.
    if resource == "hr-statutory-ids"
        && columns.iter().any(|column| column == "value")
        && !rows.is_empty()
    {
        let args = hr_child_audit_args(
            organization_id,
            company_id,
            resource,
            table,
            &columns,
            &rows,
        )?;
        client
            .call_reducer(stdb_client::reducer_call!("log_hr_pii_read", args))
            .await
            .map_err(ApiError::internal)?;
    }
    Ok(rows)
}

#[cfg(test)]
#[path = "hr_tests.rs"]
mod tests;

pub(super) async fn manager_employee_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
) -> Result<Option<u64>, ApiError> {
    let sql = format!("SELECT id, user_id FROM hr_employee WHERE organization_id = {organization_id} AND is_active = true");
    let target = identity_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.iter()
        .find(|row| row_identity_option_is(row, "userId", "user_id", target))
        .map(row_id_u64_strict)
        .transpose()
        .map_err(ApiError::Internal)
}

pub(super) async fn maybe_log_hr_pii_read(
    client: &StdbClient,
    organization_id: u64,
    resource: &str,
    table_name: &str,
    fields: &[String],
    row_count: u32,
    record_id: u64,
) {
    if !is_hr_pii_resource(resource) || !hr_fields_require_read_audit(resource, fields) {
        return;
    }
    let purpose = purpose_for_hr_resource(resource);
    let args = serde_json::json!([organization_id, {"company_id": null, "purpose": purpose, "resource_key": resource, "table_name": table_name, "record_id": record_id, "fields_accessed": fields, "row_count": row_count}]);
    if let Err(e) = client
        .call_reducer(stdb_client::reducer_call!("log_hr_pii_read", args))
        .await
    {
        tracing::warn!(resource, error = %e, "hr pii read audit failed");
    }
}

pub(super) async fn read_my_employee(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let target = identity_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    let cols = resolve_http_sql_columns("my-employee", fa).map_err(ApiError::Internal)?;
    let needs_user_id = !cols.iter().any(|column| column == "user_id");
    let mut fetch_cols = cols.clone();
    if needs_user_id {
        fetch_cols.push("user_id".to_string());
    }
    let sql = format!(
        "SELECT {} FROM hr_employee WHERE organization_id = {organization_id} AND is_active = true",
        fetch_cols.join(", ")
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(|row| row_identity_option_is(row, "userId", "user_id", target));
    if needs_user_id {
        for row in &mut rows {
            if let Value::Object(fields) = row {
                fields.remove("userId");
                fields.remove("user_id");
            }
        }
    }
    let record_id = rows
        .first()
        .and_then(|r| r.get("id").and_then(|v| v.as_u64()))
        .unwrap_or(0);
    maybe_log_hr_pii_read(
        client,
        organization_id,
        "my-employee",
        "hr_employee",
        &cols,
        rows.len() as u32,
        record_id,
    )
    .await;
    Ok(rows)
}

pub(super) async fn read_direct_reports(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let Some(manager_id) = manager_employee_id(client, organization_id, identity_hex).await? else {
        return Ok(vec![]);
    };
    let cols = resolve_http_sql_columns("direct-reports", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM hr_employee WHERE organization_id = {organization_id} AND parent_id = {manager_id} AND is_active = true", cols.join(", "));
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    maybe_log_hr_pii_read(
        client,
        organization_id,
        "direct-reports",
        "hr_employee",
        &cols,
        rows.len() as u32,
        0,
    )
    .await;
    Ok(rows)
}

pub(super) async fn read_employees(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let cols = resolve_http_sql_columns("employees", fa).map_err(ApiError::Internal)?;
    let can_list_all = has_hr_permission(fa, "hr_employee", "read")
        || has_hr_permission(fa, "hr_employee", "create")
        || has_hr_permission(fa, "hr_employee", "update")
        || has_hr_permission(fa, "hr_employee", "view_pii");
    let needs_user_id = !can_list_all && !cols.iter().any(|column| column == "user_id");
    let mut fetch_cols = cols.clone();
    if needs_user_id {
        fetch_cols.push("user_id".to_string());
    }
    let sql = format!(
        "SELECT {} FROM hr_employee WHERE organization_id = {organization_id} AND is_active = true",
        fetch_cols.join(", ")
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    if !can_list_all {
        let target = identity_hex
            .trim()
            .trim_start_matches("0x")
            .trim_start_matches("0X");
        rows.retain(|row| row_identity_option_is(row, "userId", "user_id", target));
        if needs_user_id {
            for row in &mut rows {
                if let Value::Object(fields) = row {
                    fields.remove("userId");
                    fields.remove("user_id");
                }
            }
        }
    }
    let record_id = rows
        .first()
        .and_then(|r| r.get("id").and_then(|v| v.as_u64()))
        .unwrap_or(0);
    maybe_log_hr_pii_read(
        client,
        organization_id,
        "employees",
        "hr_employee",
        &cols,
        rows.len() as u32,
        record_id,
    )
    .await;
    Ok(rows)
}
