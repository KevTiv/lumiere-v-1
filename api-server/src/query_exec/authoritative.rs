//! Authorized single-record resource reads.

use super::row_company_matches;
use super::row_values::filter_and_strip_soft_deleted;
use crate::error::ApiError;
use serde_json::Value;
use stdb_auth::{
    has_resource_read_permission, registry_get, select_org_and_company_scoped_sql,
    select_org_scoped_sql, FieldAccessContext,
};
use stdb_client::StdbClient;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AuthoritativeResourceScope {
    Organization,
    OrganizationAndCompany,
    OrganizationOptionalCompany,
}

pub(crate) fn authoritative_resource_scope(resource: &str) -> Option<AuthoritativeResourceScope> {
    match resource {
        "products" => Some(AuthoritativeResourceScope::Organization),
        "contacts" => Some(AuthoritativeResourceScope::OrganizationOptionalCompany),
        "sale-orders" | "purchase-orders" | "tasks" | "account-moves" | "account-payments"
        | "expense-sheets" | "mrp-productions" => {
            Some(AuthoritativeResourceScope::OrganizationAndCompany)
        }
        _ => None,
    }
}

pub(crate) fn authoritative_record_sql(
    resource: &str,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<(String, AuthoritativeResourceScope), ApiError> {
    if record_id == 0 || organization_id == 0 || company_id == 0 {
        return Err(ApiError::Unprocessable(
            "organization, company, and record IDs must be positive".into(),
        ));
    }
    if field_access.is_none_or(|access| access.organization_id != organization_id) {
        return Err(ApiError::NotFound(
            "Authoritative resource not found".into(),
        ));
    }
    if !has_resource_read_permission(field_access, resource) {
        return Err(ApiError::NotFound(
            "Authoritative resource not found".into(),
        ));
    }
    let scope = authoritative_resource_scope(resource)
        .ok_or_else(|| ApiError::NotFound("Authoritative resource not found".into()))?;
    let registry = registry_get(resource)
        .ok_or_else(|| ApiError::NotFound("Authoritative resource not found".into()))?;
    let id_filter = format!(" AND id = {record_id}");
    let sql = match scope {
        AuthoritativeResourceScope::OrganizationAndCompany => select_org_and_company_scoped_sql(
            resource,
            &registry.table,
            organization_id,
            company_id,
            field_access,
            &id_filter,
            "",
        ),
        AuthoritativeResourceScope::Organization
        | AuthoritativeResourceScope::OrganizationOptionalCompany => select_org_scoped_sql(
            resource,
            &registry.table,
            organization_id,
            field_access,
            &id_filter,
            "",
        ),
    }
    .map_err(ApiError::Internal)?;
    Ok((sql, scope))
}

pub async fn execute_authorized_resource_record(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<Option<Value>, ApiError> {
    let (sql, scope) = authoritative_record_sql(
        resource,
        organization_id,
        company_id,
        record_id,
        field_access,
    )?;
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;

    if scope == AuthoritativeResourceScope::OrganizationOptionalCompany {
        rows.retain(|row| row_company_matches(row, company_id, true));
    }
    if resource == "contacts" {
        filter_and_strip_soft_deleted(&mut rows);
    }
    Ok(rows.into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finance_board_sources_use_company_and_field_authorization() {
        for (resource, grant, table) in [
            (
                "account-payments",
                "account_payment:read",
                "account_payment",
            ),
            ("expense-sheets", "expense_sheet:read", "expense_sheet"),
        ] {
            let mut access = FieldAccessContext {
                organization_id: 42,
                role_id: 1,
                role_permissions: vec![grant.into()],
                ..FieldAccessContext::default()
            };
            let (sql, scope) = authoritative_record_sql(resource, 42, 7, 9, Some(&access)).unwrap();
            assert_eq!(scope, AuthoritativeResourceScope::OrganizationAndCompany);
            assert!(
                sql.contains(&format!(
                    "FROM {table} WHERE organization_id = 42 AND company_id = 7 AND id = 9"
                )),
                "{sql}"
            );
            access.field_permissions.push(
                serde_json::from_value(json!({
                    "organizationId": 42, "roleId": 1, "resource": resource,
                    "action": "read", "allowedFields": ["state"]
                }))
                .unwrap(),
            );
            let (sql, _) = authoritative_record_sql(resource, 42, 7, 9, Some(&access)).unwrap();
            assert!(!sql.contains("name"), "{sql}");
            assert!(!sql.contains("amount"), "{sql}");
            assert!(sql.contains("state"));
            assert!(authoritative_record_sql(resource, 43, 7, 9, Some(&access)).is_err());
            access.role_permissions.clear();
            assert!(authoritative_record_sql(resource, 42, 7, 9, Some(&access)).is_err());
        }
    }
}
