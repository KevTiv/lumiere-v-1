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
        "sale-orders" | "purchase-orders" | "tasks" | "account-moves" | "mrp-productions" => {
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
            " LIMIT 1",
        ),
        AuthoritativeResourceScope::Organization
        | AuthoritativeResourceScope::OrganizationOptionalCompany => select_org_scoped_sql(
            resource,
            &registry.table,
            organization_id,
            field_access,
            &id_filter,
            " LIMIT 1",
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
