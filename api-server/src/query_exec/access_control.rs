//! Identity and access-control resource reads.

use super::row_values::sort_rows_by_id_desc;
use crate::error::ApiError;
use serde_json::Value;
use stdb_auth::{identity_sql_literal, resolve_http_sql_columns, FieldAccessContext};
use stdb_client::StdbClient;

pub(crate) async fn read_roles(
    client: &StdbClient,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let full_sql = "SELECT * FROM role WHERE is_active = true";
    if let Ok(rows) = client.query_sql(full_sql).await {
        return Ok(rows);
    }

    let sql = stdb_auth::select_roles_active_sql(field_access).map_err(ApiError::Internal)?;
    client.query_sql(&sql).await.map_err(ApiError::internal)
}

pub(crate) async fn read_user_roles(
    client: &StdbClient,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let sql = stdb_auth::select_user_role_assignments_for_identity_sql(identity_hex, field_access)
        .map_err(ApiError::Internal)?;
    client.query_sql(&sql).await.map_err(ApiError::internal)
}

pub(crate) async fn read_user_organization(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let columns = resolve_http_sql_columns(resource, field_access).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT {} FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true",
        columns.join(", ")
    );
    client.query_sql(&sql).await.map_err(ApiError::internal)
}

pub(super) async fn read_audit_rules(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, table_name, log_reads, log_writes, log_deletes, log_logins, is_active FROM audit_rule WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(super) async fn read_audit_log(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, company_id, table_name, record_id, action, old_values, new_values, session_id, ip_address, user_agent, timestamp FROM audit_log WHERE organization_id = {organization_id} ORDER BY id DESC LIMIT 500"
    );
    client.query_sql(&sql).await.map_err(ApiError::internal)
}

pub(super) async fn read_org_permissions(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, subject, role_id, resource, action, effect, created_by, created_at FROM org_permission WHERE organization_id = {organization_id}"
            );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(super) async fn read_field_permissions(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, subject, role_id, resource, action, allowed_fields, created_by, created_at FROM field_permission WHERE organization_id = {organization_id}"
            );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(super) async fn read_policy_snapshots(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
) -> Result<Vec<Value>, ApiError> {
    let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
                "SELECT id, organization_id, user_identity, role_id, role_name, role_permissions, org_permission_grants, field_permissions, is_superuser, version_hash, refreshed_at FROM policy_snapshot WHERE organization_id = {organization_id} AND user_identity = {id}"
            );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}
