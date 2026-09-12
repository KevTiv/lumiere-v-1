use crate::error::ApiError;
use serde_json::Value;
use stdb_auth::{
    has_hr_permission, hr_fields_require_read_audit, is_hr_pii_resource, purpose_for_hr_resource,
    resolve_http_sql_columns, FieldAccessContext,
};
use stdb_client::StdbClient;

use super::row_values::{row_id_u64_strict, row_identity_option_is};

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
