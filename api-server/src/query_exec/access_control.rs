//! Identity and access-control resource reads.

use super::company_scope::accounting_read_permission_resource;
use super::row_values::sort_rows_by_id_desc;
use super::{documents, hr};
use crate::error::ApiError;
use serde_json::Value;
use stdb_auth::{
    has_resource_read_permission, identity_sql_literal, registry_get, resolve_http_sql_columns,
    FieldAccessContext,
};
use stdb_client::StdbClient;

pub(super) fn require_ui_child_read_permission(
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<(), ApiError> {
    let allowed = match resource {
        "hr-leave-allocations" | "hr-offboarding-checklists" | "hr-statutory-ids" => {
            hr::has_hr_child_read_permission(field_access, resource)
        }
        "document-signature-requests" | "document-legal-holds" | "document-external-refs" => {
            documents::has_document_read_permission(field_access)
        }
        resource if crate::workflow_reads::is_private_workflow_resource(resource) => {
            // Match the owner-read route's canonical workflow permission. Private
            // projections are not registry entries and have no independent role grant.
            let permission_resource = if registry_get(resource).is_some() {
                resource
            } else {
                "workflows"
            };
            field_access.is_some_and(|access| {
                !stdb_auth::resource_read_denied(access, permission_resource)
                    && (has_resource_read_permission(Some(access), permission_resource)
                        || access.role_permissions.iter().any(|permission| {
                            permission == "module:workflows:read"
                                || permission == "module:workflows:*"
                        }))
            })
        }
        _ => {
            stdb_auth::session_read_resource(resource)
                || has_resource_read_permission(field_access, resource)
                || accounting_read_permission_resource(resource)
                    .is_some_and(|parent| has_resource_read_permission(field_access, parent))
        }
    };
    let context_matches = field_access.is_some_and(|access| {
        organization_id > 0
            && access.organization_id == organization_id
            && identity_sql_literal(identity_hex)
                .ok()
                .is_some_and(|identity| {
                    identity_sql_literal(&access.identity_hex).ok().as_ref() == Some(&identity)
                })
    });
    if !allowed
        || !context_matches
        || field_access.is_some_and(|a| stdb_auth::resource_read_denied(a, resource))
    {
        return Err(ApiError::Forbidden(format!(
            "Read permission denied for resource '{resource}'"
        )));
    }
    Ok(())
}

pub(crate) async fn read_roles(
    client: &StdbClient,
    organization_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let sql = roles_sql(organization_id, field_access)?;
    client.query_sql(&sql).await.map_err(ApiError::internal)
}

fn roles_sql(
    organization_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<String, ApiError> {
    let mut columns =
        resolve_http_sql_columns("roles", field_access).map_err(ApiError::Internal)?;
    // This identity/bootstrap resource also feeds RBACBridge and role management.
    // Keep their existing permission descriptors, but never fetch SELECT * or
    // roles from another tenant. Descriptors do not grant the actor those roles.
    columns.push("permissions".into());
    let mut filter = String::new();
    if let Some(access) = field_access {
        if access.organization_id != organization_id {
            return Err(ApiError::Forbidden(
                "Role organization scope changed".into(),
            ));
        }
        if !stdb_auth::permission_allowed(access, "role", "read") {
            let mut ids = access.role_ids.clone();
            ids.push(access.role_id);
            ids.sort_unstable();
            ids.dedup();
            filter.push_str(&format!(
                " AND ({})",
                ids.iter()
                    .map(|id| format!("id = {id}"))
                    .collect::<Vec<_>>()
                    .join(" OR ")
            ));
        }
    }
    Ok(format!(
        "SELECT {} FROM role WHERE organization_id = {organization_id} AND is_active = true{filter}",
        columns.join(", ")
    ))
}

#[cfg(test)]
mod role_scope_tests {
    use super::*;

    #[test]
    fn role_queries_are_tenant_scoped_and_keep_the_existing_rbac_descriptors() {
        for organization_id in [42, 99] {
            let sql = roles_sql(organization_id, None).unwrap();
            assert!(sql.ends_with(&format!(
                "FROM role WHERE organization_id = {organization_id} AND is_active = true"
            )));
            assert!(!sql.contains("SELECT *"));
            assert!(sql.contains("permissions"));
            assert!(!sql.contains("metadata"));
            assert!(sql.contains("id, organization_id"));
        }
    }

    #[test]
    fn role_hydration_limits_non_administrators_to_their_effective_role_set() {
        let access = FieldAccessContext {
            organization_id: 42,
            role_id: 7,
            role_ids: vec![9, 7],
            role_permissions: vec!["contact:read".into()],
            ..Default::default()
        };
        let sql = roles_sql(42, Some(&access)).unwrap();
        assert!(sql.ends_with("AND (id = 7 OR id = 9)"));
        assert!(!sql.contains("SELECT *"));
        assert!(roles_sql(43, Some(&access)).is_err());
    }
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
        "SELECT id, organization_id, company_id, table_name, record_id, action, old_values, new_values, session_id, ip_address, user_agent, timestamp FROM audit_log WHERE organization_id = {organization_id}"
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    rows.truncate(500);
    Ok(rows)
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
