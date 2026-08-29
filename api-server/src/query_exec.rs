//! Execute `/v1/query/:resource` SQL via `stdb-auth` resource registry + special cases.
//! Non-registry virtual resources are allowlisted in `crates/stdb-auth/assets/query_exec_non_registry.json`
//! (validated by `make codegen` / `lumiere-codegen`).

use std::collections::HashSet;

use serde_json::Value;

use crate::error::ApiError;
use stdb_auth::{
    erp_org_extra_where, has_hr_permission, has_resource_read_permission,
    hr_fields_require_read_audit, identity_sql_literal, is_hr_pii_resource,
    purpose_for_hr_resource, registry_get, resolve_http_sql_columns, select_company_scoped_sql,
    select_org_and_company_scoped_sql, select_org_scoped_sql, FieldAccessContext,
};
use stdb_client::StdbClient;
use stdb_config::runtime_is_production;

fn row_not_soft_deleted(r: &Value) -> bool {
    match r.get("deletedAt").or_else(|| r.get("deleted_at")) {
        None | Some(Value::Null) => true,
        Some(Value::Object(obj)) if obj.contains_key("none") => true,
        Some(_) => false,
    }
}

fn ai_skill_permission_allowed(field_access: Option<&FieldAccessContext>, action: &str) -> bool {
    field_access.is_some_and(|access| {
        access.is_superuser
            || access.role_permissions.iter().any(|permission| {
                permission == "*:*"
                    || permission == "ai_skill:*"
                    || permission == &format!("ai_skill:{action}")
            })
    })
}

fn strip_soft_delete_fields(row: &mut Value) {
    if let Value::Object(map) = row {
        map.remove("deletedAt");
        map.remove("deleted_at");
    }
}

fn filter_and_strip_soft_deleted(rows: &mut Vec<Value>) {
    rows.retain(|r| row_not_soft_deleted(r));
    for row in rows.iter_mut() {
        strip_soft_delete_fields(row);
    }
}

fn row_not_archived(r: &Value) -> bool {
    match r.get("archivedAt").or_else(|| r.get("archived_at")) {
        None | Some(Value::Null) => true,
        Some(Value::Object(obj)) if obj.contains_key("none") => true,
        Some(_) => false,
    }
}

fn strip_archived_fields(row: &mut Value) {
    if let Value::Object(map) = row {
        map.remove("archivedAt");
        map.remove("archived_at");
    }
}

fn filter_and_strip_archived(rows: &mut Vec<Value>) {
    rows.retain(|r| row_not_archived(r));
    for row in rows.iter_mut() {
        strip_archived_fields(row);
    }
}

fn row_id_u64(row: &Value) -> u64 {
    row.get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            row.get("id")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0)
}

/// Strict variant of `row_id_u64` that surfaces parse failures instead of
/// silently returning zero. Use this wherever the ID feeds a business
/// operation rather than a sort comparator.
fn row_id_u64_strict(row: &Value) -> Result<u64, String> {
    let v = row
        .get("id")
        .ok_or_else(|| "row missing id field".to_string())?;
    if v.is_null() {
        return Err("row id is null".to_string());
    }
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .ok_or_else(|| format!("row id is not a valid u64: {v}"))
}

fn optional_u64(value: Option<&Value>) -> Result<Option<u64>, String> {
    let value = match value {
        None => return Ok(None),
        Some(v) => v,
    };
    if value.is_null() {
        return Ok(None);
    }
    // SpacetimeDB None encoding: {none: ...}
    if let Some(obj) = value.as_object() {
        if obj.contains_key("none") {
            return Ok(None);
        }
        // SpacetimeDB Some encoding: {some: [v]} or {Some: [v]}
        if let Some(some_val) = obj.get("some").or_else(|| obj.get("Some")) {
            let inner = some_val
                .as_array()
                .and_then(|arr| arr.first())
                .unwrap_or(some_val);
            let parsed = inner
                .as_u64()
                .or_else(|| inner.as_str().and_then(|s| s.parse().ok()))
                .ok_or_else(|| format!("cannot parse Some value as u64: {inner}"))?;
            return Ok(Some(parsed));
        }
    }
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .ok_or_else(|| format!("cannot parse value as u64: {value}"))
        .map(Some)
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Result<Option<u64>, String> {
    optional_u64(row.get(camel).or_else(|| row.get(snake)))
}

fn row_enum_tag_is(row: &Value, column: &str, expected: &[&str]) -> bool {
    row.get(column)
        .and_then(Value::as_str)
        .is_some_and(|tag| expected.contains(&tag))
}

fn identity_value_is(value: &Value, target_hex: &str) -> bool {
    if let Some(hex) = value.as_str() {
        return hex
            .trim_start_matches("0x")
            .trim_start_matches("0X")
            .eq_ignore_ascii_case(target_hex);
    }
    if let Some(inner) = value.as_array().and_then(|items| items.first()) {
        return identity_value_is(inner, target_hex);
    }
    value
        .as_object()
        .and_then(|object| object.get("some").or_else(|| object.get("Some")))
        .is_some_and(|inner| identity_value_is(inner, target_hex))
}

fn row_identity_option_is(row: &Value, camel: &str, snake: &str, target_hex: &str) -> bool {
    row.get(camel)
        .or_else(|| row.get(snake))
        .is_some_and(|value| identity_value_is(value, target_hex))
}

fn sort_rows_by_id_desc(rows: &mut [Value]) {
    rows.sort_by(|a, b| row_id_u64(b).cmp(&row_id_u64(a)));
}

fn enforce_requested_company(
    allowed_company_id: u64,
    requested_company_id: Option<u64>,
    denied_message: &str,
) -> Result<u64, ApiError> {
    if requested_company_id.is_some_and(|requested| requested != allowed_company_id) {
        return Err(ApiError::Forbidden(denied_message.into()));
    }
    Ok(allowed_company_id)
}

pub(crate) async fn company_ids_for_organization(
    client: &StdbClient,
    org_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<u64>, ApiError> {
    // SpacetimeDB HTTP SQL returns Unsupported for `ORDER BY is_parent DESC, id ASC` on `company`.
    // Match reducer logic: parent companies first, then by id (organization.rs default_company).
    let sql = select_org_scoped_sql("companies", "company", org_id, fa, "", "")
        .map_err(|e| ApiError::Internal(e))?;
    let mut rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    rows.sort_by(|a, b| {
        let pa = a
            .get("isParent")
            .or_else(|| a.get("is_parent"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let pb = b
            .get("isParent")
            .or_else(|| b.get("is_parent"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        pb.cmp(&pa).then_with(|| {
            let ia = a
                .get("id")
                .and_then(|v| v.as_u64())
                .or_else(|| {
                    a.get("id")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse().ok())
                })
                .unwrap_or(0);
            let ib = b
                .get("id")
                .and_then(|v| v.as_u64())
                .or_else(|| {
                    b.get("id")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse().ok())
                })
                .unwrap_or(0);
            ia.cmp(&ib)
        })
    });
    let mut out = Vec::new();
    for r in rows {
        if !row_not_soft_deleted(&r) {
            continue;
        }
        let id = r.get("id").and_then(|v| v.as_u64()).or_else(|| {
            r.get("id")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse().ok())
        });
        if let Some(u) = id {
            if u > 0 {
                out.push(u);
            }
        }
    }
    Ok(out)
}

pub async fn default_company_id(client: &StdbClient, org_id: u64) -> Result<Option<u64>, ApiError> {
    Ok(company_ids_for_organization(client, org_id, None)
        .await?
        .into_iter()
        .next())
}

/// Resolve the only CRM company visible to this authenticated membership.
///
/// A company-bound membership is restricted to that company. An organization-level
/// membership deliberately falls back to the default company; it does not imply an
/// all-companies grant. A requested browser company is treated as intent and must
/// equal the server-derived scope.
pub async fn resolve_crm_company_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
) -> Result<u64, ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT id, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true"
    );
    let memberships = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let membership = memberships
        .first()
        .ok_or_else(|| ApiError::Forbidden("No active organization membership".into()))?;

    let membership_company =
        row_u64(membership, "companyId", "company_id").map_err(ApiError::Internal)?;
    let allowed = match membership_company {
        Some(company_id) if company_id > 0 => company_id,
        _ => default_company_id(client, organization_id)
            .await?
            .ok_or_else(|| ApiError::Forbidden("No company assigned".into()))?,
    };

    enforce_requested_company(
        allowed,
        requested_company_id,
        "Cannot query another company's CRM data",
    )
}

/// Resolve the inventory company for the authenticated membership.
///
/// Company-bound memberships are restricted to that company. Organization-level
/// memberships fall back to the default company. A requested browser company
/// must equal the server-derived scope.
pub async fn resolve_inventory_company_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
) -> Result<u64, ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT id, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true"
    );
    let memberships = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let membership = memberships
        .first()
        .ok_or_else(|| ApiError::Forbidden("No active organization membership".into()))?;

    let membership_company =
        row_u64(membership, "companyId", "company_id").map_err(ApiError::Internal)?;
    let allowed = match membership_company {
        Some(company_id) if company_id > 0 => company_id,
        _ => default_company_id(client, organization_id)
            .await?
            .ok_or_else(|| ApiError::Forbidden("No company assigned".into()))?,
    };

    enforce_requested_company(
        allowed,
        requested_company_id,
        "Cannot query another company's inventory data",
    )
}

/// Resolve the only Purchasing company visible to the authenticated membership.
pub async fn resolve_purchasing_company_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
) -> Result<u64, ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT id, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true"
    );
    let memberships = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let membership = memberships
        .first()
        .ok_or_else(|| ApiError::Forbidden("No active organization membership".into()))?;
    let membership_company =
        row_u64(membership, "companyId", "company_id").map_err(ApiError::Internal)?;
    let allowed = match membership_company {
        Some(company_id) if company_id > 0 => company_id,
        _ => default_company_id(client, organization_id)
            .await?
            .ok_or_else(|| ApiError::Forbidden("No company assigned".into()))?,
    };
    enforce_requested_company(
        allowed,
        requested_company_id,
        "Cannot query another company's Purchasing data",
    )
}

/// Resolve the only Accounting company visible to the authenticated membership.
///
/// Company-bound memberships are restricted to that company. Organization-level
/// memberships fall back to the default company. A requested browser company
/// must equal the server-derived scope. Mirrors `resolve_purchasing_company_id`;
/// every accounting table this covers carries a required (non-nullable)
/// `company_id`, so there is no org-shared row concept here to fall back to.
pub async fn resolve_accounting_company_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
) -> Result<u64, ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT id, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true"
    );
    let memberships = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let membership = memberships
        .first()
        .ok_or_else(|| ApiError::Forbidden("No active organization membership".into()))?;
    let membership_company =
        row_u64(membership, "companyId", "company_id").map_err(ApiError::Internal)?;
    let allowed = match membership_company {
        Some(company_id) if company_id > 0 => company_id,
        _ => default_company_id(client, organization_id)
            .await?
            .ok_or_else(|| ApiError::Forbidden("No company assigned".into()))?,
    };
    enforce_requested_company(
        allowed,
        requested_company_id,
        "Cannot query another company's accounting data",
    )
}

pub(crate) fn crm_resource(resource: &str) -> bool {
    matches!(
        resource,
        "leads"
            | "lead-sources"
            | "lead-lost-reasons"
            | "opportunities"
            | "opportunity-stages"
            | "opportunity-lines"
            | "opportunity-presence"
            | "contacts"
            | "contact-phone-identities"
            | "contact-role-assignments"
            | "contact-tags"
            | "contact-tag-assignments"
            | "contact-categories"
            | "contact-category-assignments"
            | "contact-segments"
            | "segment-members"
            | "contact-relationships"
            | "contact-duplicate-candidates"
            | "assignment-rules"
            | "activities"
            | "calendar-events"
            | "utm-campaigns"
            | "utm-media"
            | "utm-sources"
            | "privacy-consent"
            | "contact-communication-preferences"
            | "crm-forecast-snapshots"
            | "lead-scores"
            | "lead-score-factors"
            | "contact-segment-rules"
            | "contact-relationship-insights"
            | "crm-conversations"
            | "crm-conversation-messages"
    )
}

pub(crate) fn inventory_resource(resource: &str) -> bool {
    matches!(
        resource,
        "stock-quants"
            | "stock-moves"
            | "stock-pickings"
            | "stock-production-lots"
            | "stock-production-serials"
            | "stock-packages"
            | "stock-locations"
            | "stock-routes"
            | "stock-rules"
            | "stock-inventories"
            | "stock-cycle-counts"
            | "stock-traceability-reports"
            | "warehouses"
            | "warehouse-tasks"
            | "warehouse-3d-zones"
            | "warehouse-geo"
            | "warehouse-sync-intents"
            | "warehouse-sync-intents-pending"
            | "picking-waves"
            | "quality-checks"
            | "quality-alerts"
            | "quality-teams"
            | "replenishment-rules"
            | "picking-batches"
            | "product-categories"
    )
}

pub(crate) fn purchasing_resource(resource: &str) -> bool {
    matches!(
        resource,
        "purchase-orders"
            | "purchase-orders-to-approve"
            | "purchase-orders-partial-receipt"
            | "purchase-order-lines"
            | "purchase-order-lines-over-billed"
            | "landed-costs"
            | "landed-cost-lines"
            | "partner-banks"
            | "purchase-requisitions"
            | "purchase-requisition-lines"
            | "purchase-rfqs"
            | "purchase-rfq-lines"
            | "purchase-rfq-bids"
            | "purchase-returns"
            | "purchase-return-lines"
            | "purchase-blanket-orders"
            | "purchase-blanket-order-lines"
            | "purchase-blanket-releases"
            | "purchase-contracts"
            | "vendor-scorecards"
            | "vendor-risk-flags"
            | "consignment-agreements"
            | "purchase-approval-delegates"
            | "commodity-price-indexes"
            | "purchasing-integration-intents"
    )
}

/// Accounting resources backed by a table with a required (non-nullable)
/// `company_id`. `account-account-types`, `account-payment-terms`, and
/// `account-payment-term-lines` are deliberately excluded — those tables have
/// no `company_id` column at all and are org-wide by design.
pub(crate) fn accounting_resource(resource: &str) -> bool {
    matches!(
        resource,
        "account-accounts"
            | "account-assets"
            | "account-groups"
            | "account-journals"
            | "account-move-lines"
            | "account-moves"
            | "account-payments"
            | "account-periods"
            | "account-reconciliation-widgets"
            | "account-taxes"
            | "budgets"
            | "budget-lines"
            | "budget-posts"
            | "fiscal-years"
    )
}

fn row_company_matches(row: &Value, company_id: u64, allow_shared: bool) -> bool {
    match row_u64(row, "companyId", "company_id").ok().flatten() {
        Some(id) => id == company_id,
        None => allow_shared,
    }
}

fn filter_direct_crm_company_rows(resource: &str, company_id: u64, rows: &mut Vec<Value>) -> bool {
    let is_direct_company_owned = matches!(
        resource,
        "contacts"
            | "opportunities"
            | "contact-phone-identities"
            | "contact-role-assignments"
            | "contact-communication-preferences"
    );
    if is_direct_company_owned {
        rows.retain(|row| row_company_matches(row, company_id, false));
    }
    is_direct_company_owned
}

#[cfg(test)]
fn visible_parent_ids_from_rows(rows: &[Value], company_id: u64) -> HashSet<u64> {
    rows.iter()
        .filter(|row| row_company_matches(row, company_id, false) && row_not_soft_deleted(row))
        .map(row_id_u64)
        .filter(|id| *id > 0)
        .collect()
}

fn filter_inventory_company_rows(resource: &str, company_id: u64, rows: &mut Vec<Value>) {
    // product-categories with no company_id are org-shared and visible to all
    // company members within the organization.
    let allow_shared = matches!(resource, "product-categories");
    rows.retain(|row| row_company_matches(row, company_id, allow_shared));
}

async fn filter_crm_company_rows(
    _client: &StdbClient,
    resource: &str,
    _organization_id: u64,
    company_id: u64,
    rows: &mut Vec<Value>,
) -> Result<(), ApiError> {
    if filter_direct_crm_company_rows(resource, company_id, rows) {
        return Ok(());
    }

    match resource {
        "contact-duplicate-candidates"
        | "crm-forecast-snapshots"
        | "opportunity-lines"
        | "opportunity-presence"
        | "contact-tag-assignments"
        | "contact-category-assignments"
        | "segment-members"
        | "privacy-consent"
        | "contact-relationship-insights"
        | "contact-relationships"
        | "crm-conversations"
        | "crm-conversation-messages" => {
            rows.retain(|row| row_company_matches(row, company_id, false));
        }
        // These schemas have no company ownership field or company-owned parent.
        // They remain explicitly organization-shared until the schema models ownership.
        _ => {}
    }
    Ok(())
}

async fn manager_employee_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
) -> Result<Option<u64>, ApiError> {
    let sql = format!(
        "SELECT id, user_id FROM hr_employee WHERE organization_id = {organization_id} AND is_active = true"
    );
    let target = identity_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    rows.iter()
        .find(|row| row_identity_option_is(row, "userId", "user_id", target))
        .map(row_id_u64_strict)
        .transpose()
        .map_err(ApiError::Internal)
}

async fn maybe_log_hr_pii_read(
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
    let args = serde_json::json!([
        organization_id,
        {
            "company_id": null,
            "purpose": purpose,
            "resource_key": resource,
            "table_name": table_name,
            "record_id": record_id,
            "fields_accessed": fields,
            "row_count": row_count,
        }
    ]);
    if let Err(e) = client
        .call_reducer(stdb_client::reducer_call!("log_hr_pii_read", args))
        .await
    {
        tracing::warn!(resource, error = %e, "hr pii read audit failed");
    }
}

pub async fn execute_resource_query(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    execute_resource_query_for_company(
        client,
        resource,
        organization_id,
        identity_hex,
        field_access,
        None,
    )
    .await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthoritativeResourceScope {
    Organization,
    OrganizationAndCompany,
    OrganizationOptionalCompany,
}

fn authoritative_resource_scope(resource: &str) -> Option<AuthoritativeResourceScope> {
    match resource {
        "products" => Some(AuthoritativeResourceScope::Organization),
        "contacts" => Some(AuthoritativeResourceScope::OrganizationOptionalCompany),
        "sale-orders" | "purchase-orders" | "tasks" | "account-moves" | "mrp-productions" => {
            Some(AuthoritativeResourceScope::OrganizationAndCompany)
        }
        _ => None,
    }
}

fn authoritative_record_sql(
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
    let mut rows = client
        .query_sql(&sql)
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;

    if scope == AuthoritativeResourceScope::OrganizationOptionalCompany {
        rows.retain(|row| row_company_matches(row, company_id, true));
    }
    if resource == "contacts" {
        filter_and_strip_soft_deleted(&mut rows);
    }
    Ok(rows.into_iter().next())
}

pub async fn execute_resource_query_for_company(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
    requested_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let fa = field_access;
    let crm_company_id = if crm_resource(resource) {
        Some(
            resolve_crm_company_id(client, organization_id, identity_hex, requested_company_id)
                .await?,
        )
    } else {
        None
    };
    let inventory_company_id = if inventory_resource(resource) {
        Some(
            resolve_inventory_company_id(
                client,
                organization_id,
                identity_hex,
                requested_company_id,
            )
            .await?,
        )
    } else {
        None
    };
    let purchasing_company_id = if purchasing_resource(resource) {
        Some(
            resolve_purchasing_company_id(
                client,
                organization_id,
                identity_hex,
                requested_company_id,
            )
            .await?,
        )
    } else {
        None
    };
    let accounting_company_id = if accounting_resource(resource) {
        Some(
            resolve_accounting_company_id(
                client,
                organization_id,
                identity_hex,
                requested_company_id,
            )
            .await?,
        )
    } else {
        None
    };

    if let Some(rows) = crate::workflow_reads::execute_private_workflow_query(
        client,
        resource,
        organization_id,
        identity_hex,
        fa,
    )
    .await?
    {
        return Ok(rows);
    }

    match resource {
        "roles" => {
            let full_sql = "SELECT * FROM role WHERE is_active = true";
            if let Ok(rows) = client.query_sql(full_sql).await {
                return Ok(rows);
            }

            let sql = stdb_auth::select_roles_active_sql(fa).map_err(ApiError::Internal)?;
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "user-roles" => {
            let sql = stdb_auth::select_user_role_assignments_for_identity_sql(identity_hex, fa)
                .map_err(ApiError::Internal)?;
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "user-organization" => {
            let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
            let columns = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT {} FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true",
                columns.join(", ")
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "ai-chat-sessions" => {
            let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT id, organization_id, company_id, session_key, title, route, module, active_tab, archived, create_uid, create_date, write_uid, write_date, metadata FROM ai_chat_session WHERE organization_id = {organization_id} AND create_uid = {id} ORDER BY write_date DESC"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "ai-chat-messages" => {
            let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT id, organization_id, company_id, session_key, role, content, sources_json, ui_context_json, model, duration_ms, status, created_by, create_date, metadata FROM ai_chat_message WHERE organization_id = {organization_id} AND created_by = {id} ORDER BY create_date ASC"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "ai-action-drafts" => {
            let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND proposed_by = {id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-agent-runs" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, skill_id, run_key, status, summary, step_count, error_message, started_at, completed_at, create_date, write_date FROM ai_agent_run WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-skill-versions" => {
            let sql = format!(
                "SELECT id, organization_id, skill_id, skill_key, version, manifest_schema_version, source_hash, risk, max_steps, max_tool_calls, permissions, resources, output_types, reviewed_at, review_notes, created_at, metadata FROM ai_skill_version WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-skill-releases" => {
            let sql = format!(
                "SELECT id, organization_id, skill_id, skill_version_id, release_number, is_active, action, previous_release_id, rollback_target_release_id, released_at, reason FROM ai_skill_release WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-skill-fixtures" => {
            let sql = format!(
                "SELECT id, organization_id, skill_id, fixture_key, name, description, input_json, expected_output_json, created_at, metadata FROM ai_skill_fixture WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-skill-test-runs" => {
            if fa.is_some() || runtime_is_production() {
                let allowed = ai_skill_permission_allowed(fa, "read")
                    || ai_skill_permission_allowed(fa, "write");
                if !allowed {
                    return Err(ApiError::Forbidden(
                        "Permission denied: read on ai_skill".into(),
                    ));
                }
            }
            let sql = format!(
                "SELECT id, organization_id, company_id, skill_id, skill_version_id, fixture_id, certification_request_id, runtime_profile_id, certification_environment_id, status, output_fingerprint, source_hash, manifest_hash, fixture_hash, runtime_hash, environment_hash, policy_snapshot_hash, execution_evidence_hash, executor_run_id, failure_kind, failure_reason, executed_at, metadata FROM ai_skill_certification_evidence WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-action-drafts-inbox" => {
            // `ai_action_draft` has `organization_id`; `company_id IN (...)` is redundant and
            // SpacetimeDB SQL does not support `IN` clauses. Scope by org only.
            // HTTP SQL also rejects `ORDER BY id DESC` on this table — sort in Rust.
            let sql = format!(
                "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND status = 'pending'"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        // Wave 4 DQ / legacy approval keys — served by `workflow_reads` before this match.
        // Arms remain so `lumiere-codegen` query_exec audit stays green.
        "approval-requests-inbox"
        | "approval-requests"
        | "approval-rules"
        | "workflow-human-tasks-inbox"
        | "workflow-human-tasks"
        | "workflow-human-task-events"
        | "workflow-timers-late"
        | "workflow-outbox-dead"
        | "workflow-decision-events"
        | "workflow-migration-plans"
        | "workflow-migration-preflights"
        | "workflow-migration-results"
        | "workflow-activities"
        | "workflow-transitions"
        | "workflow-workitems" => {
            return Ok(Vec::new());
        }
        "document-templates" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, name, model, report_type, body_html, header_html, footer_html, variable_bindings_json, is_default, is_active, create_date, write_date, metadata FROM document_template WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "mail-templates" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, name, model, subject, body_html, document_template_id, attach_document, is_default, is_active, create_date, write_date, metadata FROM mail_template WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        // SpacetimeDB SQL cannot express a NULL/None comparison against an
        // `Option<u64>` column: `IS NULL`/`IS NOT NULL` are rejected outright
        // ("Unsupported expression"), and no literal (`NULL`, `'none'`, `0`,
        // struct-literal syntax) parses as the sum type `(some: U64 | none:
        // ())` either. The erp-org-sql extraWhere for these two resources
        // used to include `AND timesheet_invoice_id IS NULL`, which SpacetimeDB
        // always rejected with a 400 — build the WHERE clause without it and
        // filter the None rows out here instead.
        "timesheets-to-validate" | "timesheets-unbilled" => {
            let reg = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
            let extra_where = if resource == "timesheets-to-validate" {
                " AND validation_status = 'draft'"
            } else {
                " AND validation_status = 'validated' AND timesheet_invoice_type = 'billable'"
            };
            let sql =
                select_org_scoped_sql(resource, &reg.table, organization_id, fa, extra_where, "")
                    .map_err(ApiError::Internal)?;
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|row| {
                row_u64(row, "timesheetInvoiceId", "timesheet_invoice_id")
                    .ok()
                    .flatten()
                    .is_none()
            });
            return Ok(rows);
        }
        "sale-orders-to-approve"
        | "leaves-to-approve"
        | "payslips-to-export"
        | "expense-sheets-to-approve"
        | "expenses-missing-receipt"
        | "expense-policy-exceptions" => {
            let registry = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
            let extra_where = if resource == "expenses-missing-receipt" {
                " AND has_receipt = false"
            } else {
                ""
            };
            let sql = select_org_scoped_sql(
                resource,
                &registry.table,
                organization_id,
                fa,
                extra_where,
                "",
            )
            .map_err(ApiError::Internal)?;
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let expected: &[&str] = match resource {
                "sale-orders-to-approve" => &["ToApprove"],
                "leaves-to-approve" => &["Confirm", "ValidatedOne"],
                "payslips-to-export" => &["Verify"],
                "expense-sheets-to-approve" => &["Submitted"],
                "expenses-missing-receipt" => &["Draft"],
                "expense-policy-exceptions" => &["Pending"],
                _ => unreachable!(),
            };
            rows.retain(|row| row_enum_tag_is(row, "state", expected));
            return Ok(rows);
        }
        "purchase-orders-to-approve" => {
            let registry = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
            let company_id = purchasing_company_id
                .ok_or_else(|| ApiError::Internal("purchasing company id not resolved".into()))?;
            let sql = select_org_and_company_scoped_sql(
                resource,
                &registry.table,
                organization_id,
                company_id,
                fa,
                "",
                "",
            )
            .map_err(ApiError::Internal)?;
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|row| row_enum_tag_is(row, "state", &["ToApprove"]));
            return Ok(rows);
        }
        "partner-banks" => {
            let registry = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
            let company_id = purchasing_company_id
                .ok_or_else(|| ApiError::Internal("purchasing company id not resolved".into()))?;
            let sql = select_org_scoped_sql(resource, &registry.table, organization_id, fa, "", "")
                .map_err(ApiError::Internal)?;
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|row| row_company_matches(row, company_id, true));
            return Ok(rows);
        }
        "landed-cost-lines" => {
            let company_id = purchasing_company_id
                .ok_or_else(|| ApiError::Internal("purchasing company id not resolved".into()))?;
            let cost_rows = client
                .query_sql(&format!(
                    "SELECT id, company_id FROM stock_landed_cost WHERE organization_id = {organization_id} AND company_id = {company_id}"
                ))
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let cost_ids: HashSet<u64> = cost_rows
                .iter()
                .map(row_id_u64)
                .filter(|id| *id > 0)
                .collect();
            if cost_ids.is_empty() {
                return Ok(Vec::new());
            }
            let registry = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
            let sql = select_org_scoped_sql(resource, &registry.table, organization_id, fa, "", "")
                .map_err(ApiError::Internal)?;
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|row| {
                row_u64(row, "landedCostId", "landed_cost_id")
                    .ok()
                    .flatten()
                    .is_some_and(|id| cost_ids.contains(&id))
            });
            rows.sort_by(|a, b| {
                let key = |row: &Value| {
                    (
                        row_u64(row, "landedCostId", "landed_cost_id")
                            .ok()
                            .flatten()
                            .unwrap_or(0),
                        row_id_u64(row),
                    )
                };
                key(a).cmp(&key(b))
            });
            return Ok(rows);
        }
        "queued-mail-messages" => {
            let sql = format!(
                "SELECT id, organization_id, model, res_id, author_id, body, message_type, subtype, date, parent_id, attachment_ids, metadata FROM mail_message WHERE organization_id = {organization_id} AND message_type = 'Email'"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            rows.retain(|row| {
                row.get("metadata")
                    .and_then(|v| v.as_str())
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .and_then(|meta| {
                        meta.get("delivery")
                            .and_then(|d| d.as_str())
                            .map(|d| d == "queued")
                    })
                    .unwrap_or(false)
            });
            return Ok(rows);
        }
        "consolidation-accounts" => {
            let col = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM consolidation_account", col.join(", "));
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "consolidation-journals" => {
            let col = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM consolidation_journal", col.join(", "));
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "consolidation-elimination-entries" => {
            let col = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT {} FROM consolidation_elimination_entry",
                col.join(", ")
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "account-payment-term-lines" => {
            let sql_terms = select_org_scoped_sql(
                "account-payment-terms",
                "account_payment_term",
                organization_id,
                fa,
                "",
                "",
            )
            .map_err(ApiError::Internal)?;
            let terms = client
                .query_sql(&sql_terms)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let mut term_ids: Vec<u64> = Vec::new();
            for t in terms {
                if let Some(id) = t.get("id").and_then(|v| v.as_u64()).or_else(|| {
                    t.get("id")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse().ok())
                }) {
                    if id > 0 {
                        term_ids.push(id);
                    }
                }
            }
            if term_ids.is_empty() {
                return Ok(vec![]);
            }
            let col = resolve_http_sql_columns("account-payment-term-lines", fa)
                .map_err(ApiError::Internal)?;
            let or_clause = term_ids
                .iter()
                .map(|id| format!("payment_term_id = {id}"))
                .collect::<Vec<_>>()
                .join(" OR ");
            let sql = format!(
                "SELECT {} FROM account_payment_term_line WHERE {or_clause}",
                col.join(", ")
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "account-assets" | "fixed-assets" => {
            // `account_asset` has no `organization_id`; SpacetimeDB SQL does not support
            // `IN (...)`. Fetch all rows and filter by `company_id` in Rust.
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let company_set: HashSet<u64> = ids.iter().copied().collect();
            let col = resolve_http_sql_columns("account-assets", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM account_asset", col.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                r.get("companyId")
                    .or_else(|| r.get("company_id"))
                    .and_then(|v| v.as_u64())
                    .is_some_and(|cid| company_set.contains(&cid))
            });
            return Ok(rows);
        }
        "depreciation-lines" => {
            // Two-level scoping: company -> asset -> depreciation_line. SpacetimeDB SQL does
            // not support `IN (...)`, so resolve both levels in Rust.
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let company_set: HashSet<u64> = ids.iter().copied().collect();

            let asset_rows = client
                .query_sql("SELECT id, company_id FROM account_asset")
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let company_in_set = |r: &Value| -> bool {
                r.get("companyId")
                    .or_else(|| r.get("company_id"))
                    .and_then(|v| v.as_u64())
                    .is_some_and(|cid| company_set.contains(&cid))
            };
            let asset_set: HashSet<u64> = asset_rows
                .iter()
                .filter(|r| company_in_set(r))
                .filter_map(|r| {
                    r.get("id").and_then(|v| v.as_u64()).or_else(|| {
                        r.get("id")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                })
                .filter(|id| *id > 0)
                .collect();
            if asset_set.is_empty() {
                return Ok(vec![]);
            }

            let col =
                resolve_http_sql_columns("depreciation-lines", fa).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT {} FROM account_asset_depreciation_line",
                col.join(", ")
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                r.get("assetId")
                    .or_else(|| r.get("asset_id"))
                    .and_then(|v| v.as_u64())
                    .is_some_and(|id| asset_set.contains(&id))
            });
            return Ok(rows);
        }
        "intercompany-rules" => {
            // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
            // rows and filter by `source_company_id`/`destination_company_id` in Rust.
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let company_set: HashSet<u64> = ids.iter().copied().collect();
            let col =
                resolve_http_sql_columns("intercompany-rules", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM intercompany_rule", col.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                let src = r
                    .get("sourceCompanyId")
                    .or_else(|| r.get("source_company_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let dst = r
                    .get("destinationCompanyId")
                    .or_else(|| r.get("destination_company_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                company_set.contains(&src) || company_set.contains(&dst)
            });
            rows.sort_by(|a, b| {
                let asq = a.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                let bsq = b.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                asq.cmp(&bsq)
            });
            return Ok(rows);
        }
        "intercompany-transactions" => {
            // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
            // rows and filter by `origin_company_id`/`destination_company_id` in Rust.
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let company_set: HashSet<u64> = ids.iter().copied().collect();
            let col = resolve_http_sql_columns("intercompany-transactions", fa)
                .map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM intercompany_transaction", col.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                let origin = r
                    .get("originCompanyId")
                    .or_else(|| r.get("origin_company_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let dst = r
                    .get("destinationCompanyId")
                    .or_else(|| r.get("destination_company_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                company_set.contains(&origin) || company_set.contains(&dst)
            });
            rows.sort_by(|a, b| {
                let ai = a.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let bi = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                bi.cmp(&ai)
            });
            return Ok(rows);
        }
        "pos-configs" => {
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let company_set: HashSet<u64> = ids.iter().copied().collect();
            let col = resolve_http_sql_columns("pos-configs", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM pos_config", col.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                r.get("companyId")
                    .or_else(|| r.get("company_id"))
                    .and_then(|v| v.as_u64())
                    .is_some_and(|cid| company_set.contains(&cid))
            });
            rows.sort_by(|a, b| {
                let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                an.cmp(bn)
            });
            return Ok(rows);
        }
        "pos-sessions" => {
            // Two-level scoping: company -> pos_config -> pos_session. SpacetimeDB SQL does
            // not support `IN (...)`, so resolve both levels in Rust.
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let company_set: HashSet<u64> = ids.iter().copied().collect();

            let config_rows = client
                .query_sql("SELECT id, company_id FROM pos_config")
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let config_set: HashSet<u64> = config_rows
                .iter()
                .filter(|r| {
                    r.get("companyId")
                        .or_else(|| r.get("company_id"))
                        .and_then(|v| v.as_u64())
                        .is_some_and(|cid| company_set.contains(&cid))
                })
                .filter_map(|r| {
                    r.get("id").and_then(|v| v.as_u64()).or_else(|| {
                        r.get("id")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                })
                .filter(|id| *id > 0)
                .collect();
            if config_set.is_empty() {
                return Ok(vec![]);
            }

            let col = resolve_http_sql_columns("pos-sessions", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM pos_session", col.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                r.get("configId")
                    .or_else(|| r.get("config_id"))
                    .and_then(|v| v.as_u64())
                    .is_some_and(|id| config_set.contains(&id))
            });
            rows.sort_by(|a, b| {
                let asa = a
                    .get("startAt")
                    .and_then(|v| v.as_f64())
                    .or_else(|| {
                        a.get("startAt")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                    .unwrap_or(0.0);
                let bsa = b
                    .get("startAt")
                    .and_then(|v| v.as_f64())
                    .or_else(|| {
                        b.get("startAt")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                    .unwrap_or(0.0);
                bsa.partial_cmp(&asa).unwrap_or(std::cmp::Ordering::Equal)
            });
            return Ok(rows);
        }
        "ai-insights" => {
            // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
            // rows and keep rows with NULL/missing `company_id` (org-level insights) plus
            // those matching the org's company IDs.
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            let company_set: HashSet<u64> = ids.iter().copied().collect();
            let col = resolve_http_sql_columns("ai-insights", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM ai_insight", col.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(
                |r| match r.get("companyId").or_else(|| r.get("company_id")) {
                    None | Some(Value::Null) => true,
                    Some(v) => v.as_u64().is_some_and(|cid| company_set.contains(&cid)),
                },
            );
            return Ok(rows);
        }
        "ai-document-processing-jobs" => {
            // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
            // rows and keep rows with NULL/missing `company_id` (org-level jobs) plus those
            // matching the org's company IDs.
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            let company_set: HashSet<u64> = ids.iter().copied().collect();
            let col = resolve_http_sql_columns("ai-document-processing-jobs", fa)
                .map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM ai_document_processing_job", col.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(
                |r| match r.get("companyId").or_else(|| r.get("company_id")) {
                    None | Some(Value::Null) => true,
                    Some(v) => v.as_u64().is_some_and(|cid| company_set.contains(&cid)),
                },
            );
            return Ok(rows);
        }
        "delivery-carriers"
        | "delivery-price-rules"
        | "shipping-methods"
        | "pos-payment-methods" => {
            let Some(cid) = default_company_id(client, organization_id).await? else {
                return Ok(vec![]);
            };
            let reg = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("unknown resource: {resource}")))?;
            let sql = select_company_scoped_sql(resource, &reg.table, cid, fa, "", "")
                .map_err(ApiError::Internal)?;
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "picking-batches" => {
            // inventory_company_id is already resolved for this resource above
            let cid = inventory_company_id.expect("picking-batches is an inventory resource");
            let reg = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("unknown resource: {resource}")))?;
            let sql = select_company_scoped_sql(resource, &reg.table, cid, fa, "", "")
                .map_err(ApiError::Internal)?;
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "fiscal-years" | "account-periods" => {
            let company_ids = company_ids_for_organization(client, organization_id, fa).await?;
            if company_ids.is_empty() {
                return Ok(vec![]);
            }
            let reg = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("unknown resource: {resource}")))?;
            let mut out: Vec<Value> = Vec::new();
            for cid in company_ids {
                let sql = select_company_scoped_sql(resource, &reg.table, cid, fa, "", "")
                    .map_err(ApiError::Internal)?;
                let rows = client
                    .query_sql(&sql)
                    .await
                    .map_err(|e| ApiError::Internal(e.to_string()))?;
                out.extend(rows);
            }
            out.sort_by(|a, b| {
                let da = a
                    .get("dateFrom")
                    .and_then(|v| v.as_f64())
                    .or_else(|| {
                        a.get("dateFrom")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                    .unwrap_or(0.0);
                let db = b
                    .get("dateFrom")
                    .and_then(|v| v.as_f64())
                    .or_else(|| {
                        b.get("dateFrom")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                    .unwrap_or(0.0);
                db.partial_cmp(&da).unwrap_or(std::cmp::Ordering::Equal)
            });
            return Ok(out);
        }
        "import-jobs" => {
            let sql = format!(
                "SELECT id, organization_id, table_name, file_name, total_rows, imported_rows, error_rows, status, started_at, completed_at, create_uid, create_date, metadata FROM import_job WHERE organization_id = {organization_id} LIMIT 200"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            rows.truncate(100);
            return Ok(rows);
        }
        "import-job-errors" => {
            let job_sql = format!(
                "SELECT id FROM import_job WHERE organization_id = {organization_id} LIMIT 200"
            );
            let job_rows = client
                .query_sql(&job_sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let job_ids: Vec<u64> = job_rows
                .iter()
                .filter_map(|r| row_id_u64_strict(r).ok())
                .filter(|id| *id > 0)
                .collect();
            if job_ids.is_empty() {
                return Ok(vec![]);
            }
            let id_list = job_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT id, job_id, row_number, field_name, raw_value, error_message, create_date FROM import_job_error WHERE job_id IN ({id_list}) LIMIT 500"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "form-config-fields" => {
            let config_sql =
                select_org_scoped_sql("form-configs", "form_config", organization_id, fa, "", "")
                    .map_err(ApiError::Internal)?;
            let config_rows = client
                .query_sql(&config_sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let config_ids: HashSet<u64> = config_rows
                .iter()
                .filter_map(|r| {
                    let id = row_id_u64_strict(r).ok()?;
                    (id > 0).then_some(id)
                })
                .collect();
            if config_ids.is_empty() {
                return Ok(vec![]);
            }
            let cols =
                resolve_http_sql_columns("form-config-fields", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM form_config_field", cols.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                let cid = r
                    .get("configurationId")
                    .or_else(|| r.get("configuration_id"))
                    .and_then(|v| v.as_u64())
                    .or_else(|| {
                        r.get("configuration_id")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                    .unwrap_or(0);
                config_ids.contains(&cid)
            });
            return Ok(rows);
        }
        "form-role-configs" => {
            let config_sql =
                select_org_scoped_sql("form-configs", "form_config", organization_id, fa, "", "")
                    .map_err(ApiError::Internal)?;
            let config_rows = client
                .query_sql(&config_sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let config_ids: HashSet<u64> = config_rows
                .iter()
                .filter_map(|r| {
                    let id = row_id_u64_strict(r).ok()?;
                    (id > 0).then_some(id)
                })
                .collect();
            if config_ids.is_empty() {
                return Ok(vec![]);
            }
            let cols =
                resolve_http_sql_columns("form-role-configs", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM form_role_config", cols.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            rows.retain(|r| {
                let cid = r
                    .get("configurationId")
                    .or_else(|| r.get("configuration_id"))
                    .and_then(|v| v.as_u64())
                    .or_else(|| {
                        r.get("configuration_id")
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse().ok())
                    })
                    .unwrap_or(0);
                config_ids.contains(&cid)
            });
            return Ok(rows);
        }
        "import-mapping-templates" => {
            let sql = format!(
                "SELECT id, organization_id, table_name, name, mapping_json, use_count, create_uid, create_date, write_uid, write_date FROM import_mapping_template WHERE organization_id = {organization_id} ORDER BY use_count DESC, id DESC LIMIT 200"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "audit-log" => {
            return crate::cold_tier::audit_read::merged_rows(client, organization_id).await;
        }
        "audit-rules" => {
            let sql = format!(
                "SELECT id, organization_id, table_name, log_reads, log_writes, log_deletes, log_logins, is_active FROM audit_rule WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "org-permissions" => {
            let sql = format!(
                "SELECT id, organization_id, subject, role_id, resource, action, effect, created_by, created_at FROM org_permission WHERE organization_id = {organization_id}"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "field-permissions" => {
            let sql = format!(
                "SELECT id, organization_id, subject, role_id, resource, action, allowed_fields, created_by, created_at FROM field_permission WHERE organization_id = {organization_id}"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "policy-snapshots" => {
            let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT id, organization_id, user_identity, role_id, role_name, role_permissions, org_permission_grants, field_permissions, is_superuser, version_hash, refreshed_at FROM policy_snapshot WHERE organization_id = {organization_id} AND user_identity = {id}"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        _ => {}
    }

    if resource == "my-employee" {
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
        let mut rows = client
            .query_sql(&sql)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
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
            resource,
            "hr_employee",
            &cols,
            rows.len() as u32,
            record_id,
        )
        .await;
        return Ok(rows);
    }

    if resource == "direct-reports" {
        let Some(manager_id) = manager_employee_id(client, organization_id, identity_hex).await?
        else {
            return Ok(vec![]);
        };
        let cols = resolve_http_sql_columns("direct-reports", fa).map_err(ApiError::Internal)?;
        let col_part = cols.join(", ");
        let sql = format!(
            "SELECT {col_part} FROM hr_employee WHERE organization_id = {organization_id} AND parent_id = {manager_id} AND is_active = true"
        );
        let rows = client
            .query_sql(&sql)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        maybe_log_hr_pii_read(
            client,
            organization_id,
            resource,
            "hr_employee",
            &cols,
            rows.len() as u32,
            0,
        )
        .await;
        return Ok(rows);
    }

    // H1: org-wide `employees` only for HR roles; others get self row only (same as my-employee).
    if resource == "employees" {
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
        let mut rows = client
            .query_sql(&sql)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
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
        maybe_log_hr_pii_read(
            client,
            organization_id,
            resource,
            "hr_employee",
            &cols,
            rows.len() as u32,
            rows.first()
                .and_then(|r| r.get("id").and_then(|v| v.as_u64()))
                .unwrap_or(0),
        )
        .await;
        return Ok(rows);
    }

    // Pilot ACL = owner-only on both WS and HTTP (match erp_subscriptions.rs; not full
    // `read_access_ids`). Documents/folders/versions must not fall through to org-only SQL.
    if resource == "document-folders" {
        let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
        let cols = resolve_http_sql_columns("document-folders", fa).map_err(ApiError::Internal)?;
        let col_part = cols.join(", ");
        let sql = format!(
            "SELECT {col_part} FROM doc_folder WHERE organization_id = {organization_id} AND (is_access_restricted = false OR owner_id = {id})"
        );
        return client
            .query_sql(&sql)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()));
    }

    if resource == "documents" || resource == "documents-deleted" {
        let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
        let cols = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
        let col_part = cols.join(", ");
        let deleted = if resource == "documents-deleted" {
            "true"
        } else {
            "false"
        };
        let sql = format!(
            "SELECT {col_part} FROM document WHERE organization_id = {organization_id} AND is_deleted = {deleted} AND owner_id = {id}"
        );
        return client
            .query_sql(&sql)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()));
    }

    // Pilot ACL = owner-only. `document_version` has no `owner_id`; SpacetimeDB SQL cannot
    // JOIN/subquery parent `document.owner_id`. Filter by `created_by` (same as WS).
    if resource == "document-versions" {
        let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
        let cols = resolve_http_sql_columns("document-versions", fa).map_err(ApiError::Internal)?;
        let col_part = cols.join(", ");
        let sql = format!(
            "SELECT {col_part} FROM document_version WHERE organization_id = {organization_id} AND created_by = {id}"
        );
        return client
            .query_sql(&sql)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()));
    }

    let Some(reg) = registry_get(resource) else {
        return Err(ApiError::NotFound(format!(
            "Unknown resource: \"{resource}\""
        )));
    };

    let order = match resource {
        "opportunity-stages" => "",
        "activities" => "",
        "pricelist-items" => "",
        "pos-loyalty-programs" => " ORDER BY id DESC",
        "sale-commissions" | "sale-commissions-pending" => " ORDER BY id DESC",
        // SpacetimeDB HTTP SQL rejects ORDER BY for this table; sort below.
        "landed-costs" => "",
        // Dedicated company-safe arm sorts these rows in Rust.
        "landed-cost-lines" => "",
        "contact-tags" => "",
        "contact-categories" => "",
        "contact-segments" => "",
        "quality-alerts" => "",
        "mrp-bom-lines" => " ORDER BY bom_id ASC, sequence ASC",
        "mrp-routing-workcenters" => " ORDER BY workcenter_id ASC, sequence ASC",
        // SpacetimeDB 2.0 rejects ORDER BY on the quoted reserved `start`
        // column. Calendar consumers do not rely on server row order.
        "calendar-events" => "",
        "deferred-revenue-schedules" => " ORDER BY id DESC",
        "deferred-revenue-lines" => " ORDER BY schedule_id ASC, sequence ASC",
        "revenue-recognition-rules" => " ORDER BY priority DESC, id DESC",
        "workflow-activities" => " ORDER BY workflow_id ASC, sequence ASC",
        "workflow-transitions" => " ORDER BY id ASC",
        "workflow-workitems" => " ORDER BY instance_id ASC, id ASC",
        _ => "",
    };

    // Bounded exception resources (and any erp-org-sql extraWhere) share SQL with WS subscriptions.
    // Inventory resources carry `:company_id` as a placeholder in extra_where; substitute the
    // resolved company id so the WHERE clause filters at the SQL level, not post-fetch.
    let extra_where_raw = erp_org_extra_where(resource).unwrap_or("");
    let extra_where_owned;
    let extra_where = if let Some(cid) = inventory_company_id {
        extra_where_owned = extra_where_raw.replace(":company_id", &cid.to_string());
        extra_where_owned.as_str()
    } else if let Some(cid) = purchasing_company_id {
        extra_where_owned = format!("{extra_where_raw} AND company_id = {cid}");
        extra_where_owned.as_str()
    } else if let Some(cid) = accounting_company_id {
        extra_where_owned = format!("{extra_where_raw} AND company_id = {cid}");
        extra_where_owned.as_str()
    } else {
        extra_where_raw
    };
    let mut sql = select_org_scoped_sql(
        resource,
        &reg.table,
        organization_id,
        fa,
        extra_where,
        order,
    )
    .map_err(ApiError::Internal)?;
    if resource == "calendar-events" {
        // `start` and `stop` are reserved by SpacetimeDB SQL 2.0. The field
        // policy still determines the projection; only quote those identifiers.
        sql = sql
            .replace(", start,", ", \"start\",")
            .replace(", stop,", ", \"stop\",");
    }

    let mut rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    if let Some(company_id) = crm_company_id {
        filter_crm_company_rows(client, resource, organization_id, company_id, &mut rows).await?;
    }
    if let Some(company_id) = inventory_company_id {
        filter_inventory_company_rows(resource, company_id, &mut rows);
    }
    if let Some(company_id) = purchasing_company_id {
        rows.retain(|row| row_company_matches(row, company_id, false));
    }
    if let Some(company_id) = accounting_company_id {
        rows.retain(|row| row_company_matches(row, company_id, false));
    }

    if resource == "activities"
        || resource == "companies"
        || resource == "contacts"
        || resource == "contact-phone-identities"
        || resource == "leads"
        || resource == "product-categories"
        || resource == "employees"
        || resource == "my-employee"
        || resource == "direct-reports"
    {
        filter_and_strip_soft_deleted(&mut rows);
    }

    if resource == "contact-phone-identities" || resource == "payment-accounts" {
        filter_and_strip_archived(&mut rows);
    }

    if is_hr_pii_resource(resource) {
        let cols = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
        let record_id = rows
            .first()
            .and_then(|r| r.get("id").and_then(|v| v.as_u64()))
            .unwrap_or(0);
        maybe_log_hr_pii_read(
            client,
            organization_id,
            resource,
            &reg.table,
            &cols,
            rows.len() as u32,
            record_id,
        )
        .await;
    }

    match resource {
        "contact-tags" | "contact-categories" | "contact-segments" => {
            rows.sort_by(|a, b| {
                let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                an.cmp(bn)
            });
        }
        "opportunity-stages" => {
            rows.sort_by(|a, b| {
                let asq = a.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                let bsq = b.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                asq.cmp(&bsq)
            });
        }
        "activities" | "landed-costs" => {
            rows.sort_by(|a, b| {
                let ai = a.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let bi = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                bi.cmp(&ai)
            });
        }
        "pricelist-items" => {
            rows.sort_by(|a, b| {
                let apl = a
                    .get("pricelistId")
                    .or_else(|| a.get("pricelist_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let bpl = b
                    .get("pricelistId")
                    .or_else(|| b.get("pricelist_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let asq = a.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                let bsq = b.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                apl.cmp(&bpl).then(asq.cmp(&bsq))
            });
        }
        "quality-alerts" => {
            rows.sort_by(|a, b| {
                let ai = a.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let bi = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                bi.cmp(&ai)
            });
        }
        _ => {}
    }

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn authoritative_access(permission: &str) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_id: 7,
            role_name: "member".into(),
            is_superuser: false,
            role_permissions: vec![permission.into()],
            identity_hex: "actor".into(),
            field_permissions: Vec::new(),
        }
    }

    #[test]
    fn authoritative_company_sql_is_bounded_by_scope_and_id() {
        let access = authoritative_access("sale_order:read");
        let (sql, scope) = authoritative_record_sql("sale-orders", 42, 7, 99, Some(&access))
            .expect("authorized SQL");
        assert_eq!(scope, AuthoritativeResourceScope::OrganizationAndCompany);
        assert!(sql.contains("organization_id = 42"));
        assert!(sql.contains("company_id = 7"));
        assert!(sql.contains("id = 99"));
        assert!(sql.ends_with("LIMIT 1"));
    }

    #[test]
    fn authoritative_sql_fails_closed_without_read_permission() {
        let access = authoritative_access("sale_order:write");
        assert!(authoritative_record_sql("sale-orders", 42, 7, 99, Some(&access)).is_err());
        assert!(authoritative_record_sql("sale-orders", 42, 7, 99, None).is_err());
        assert!(authoritative_record_sql("unknown", 42, 7, 99, Some(&access)).is_err());
    }

    #[test]
    fn company_bound_actor_cannot_request_another_company() {
        assert!(enforce_requested_company(7, Some(8), "cross-company").is_err());
        assert_eq!(
            enforce_requested_company(7, Some(7), "cross-company").expect("same company"),
            7
        );
    }

    #[test]
    fn enum_post_filter_matches_only_expected_sats_tags() {
        assert!(row_enum_tag_is(
            &json!({ "state": "ToApprove" }),
            "state",
            &["ToApprove"]
        ));
        assert!(row_enum_tag_is(
            &json!({ "state": "ValidatedOne" }),
            "state",
            &["Confirm", "ValidatedOne"]
        ));
        assert!(!row_enum_tag_is(
            &json!({ "state": "Approved" }),
            "state",
            &["ToApprove"]
        ));
    }

    #[test]
    fn identity_post_filter_accepts_sats_option_encodings() {
        let target = "abcdef";
        for row in [
            json!({ "userId": ["0xABCDEF"] }),
            json!({ "user_id": { "some": ["0xabcdef"] } }),
            json!({ "userId": "ABCDEF" }),
        ] {
            assert!(row_identity_option_is(&row, "userId", "user_id", target));
        }
        assert!(!row_identity_option_is(
            &json!({ "userId": { "none": [] } }),
            "userId",
            "user_id",
            target
        ));
        assert!(!row_identity_option_is(
            &json!({ "userId": ["0x123456"] }),
            "userId",
            "user_id",
            target
        ));
    }

    #[test]
    fn row_not_soft_deleted_treats_missing_and_null_as_live() {
        assert!(row_not_soft_deleted(&json!({ "id": 1 })));
        assert!(row_not_soft_deleted(&json!({ "id": 1, "deletedAt": null })));
        assert!(row_not_soft_deleted(
            &json!({ "id": 1, "deleted_at": { "none": [] } })
        ));
    }

    #[test]
    fn row_not_soft_deleted_rejects_timestamp() {
        assert!(!row_not_soft_deleted(&json!({
            "id": 1,
            "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 }
        })));
    }

    #[test]
    fn filter_and_strip_soft_deleted_removes_deleted_rows_and_field() {
        let mut rows = vec![
            json!({ "id": 1, "deletedAt": null }),
            json!({ "id": 2, "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 } }),
        ];
        filter_and_strip_soft_deleted(&mut rows);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("id").and_then(|v| v.as_u64()), Some(1));
        assert!(rows[0].get("deletedAt").is_none());
    }

    #[test]
    fn crm_company_match_distinguishes_owned_shared_and_cross_company_rows() {
        let owned = json!({ "companyId": 7 });
        let shared = json!({ "companyId": null });
        let tagged = json!({ "company_id": { "some": [7] } });

        assert!(row_company_matches(&owned, 7, false));
        assert!(row_company_matches(&tagged, 7, false));
        assert!(!row_company_matches(&owned, 8, true));
        assert!(row_company_matches(&shared, 7, true));
        assert!(!row_company_matches(&shared, 7, false));
    }

    #[test]
    fn direct_company_owned_crm_resources_exclude_null_and_cross_company_rows() {
        for resource in [
            "contacts",
            "opportunities",
            "contact-phone-identities",
            "contact-role-assignments",
            "contact-communication-preferences",
        ] {
            let mut rows = vec![
                json!({ "id": 1, "companyId": 7 }),
                json!({ "id": 2, "companyId": null }),
                json!({ "id": 3, "companyId": 8 }),
            ];

            assert!(filter_direct_crm_company_rows(resource, 7, &mut rows));
            assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
        }
    }

    #[test]
    fn parent_visibility_excludes_null_cross_company_and_deleted_rows() {
        let rows = vec![
            json!({ "id": 1, "companyId": 7, "deletedAt": null }),
            json!({ "id": 2, "companyId": null, "deletedAt": null }),
            json!({ "id": 3, "companyId": 8, "deletedAt": null }),
            json!({ "id": 4, "companyId": 7, "deletedAt": { "some": [1] } }),
        ];

        assert_eq!(visible_parent_ids_from_rows(&rows, 7), HashSet::from([1]));
    }

    #[test]
    fn explicitly_organization_shared_resources_are_not_direct_company_filtered() {
        let mut rows = vec![json!({ "id": 1, "organizationId": 9 })];

        assert!(!filter_direct_crm_company_rows(
            "contact-tags",
            7,
            &mut rows
        ));
        assert_eq!(rows, vec![json!({ "id": 1, "organizationId": 9 })]);

        let mut rows = vec![json!({ "id": 1, "organizationId": 9 })];
        assert!(!filter_direct_crm_company_rows(
            "contact-categories",
            7,
            &mut rows
        ));
        assert_eq!(rows, vec![json!({ "id": 1, "organizationId": 9 })]);
    }

    #[test]
    fn realtime_exact_company_resources_project_company_id() {
        for resource in [
            "contacts",
            "opportunities",
            "opportunity-lines",
            "opportunity-presence",
            "contact-phone-identities",
            "contact-role-assignments",
            "contact-communication-preferences",
            "contact-tag-assignments",
            "contact-category-assignments",
            "segment-members",
            "privacy-consent",
            "contact-relationship-insights",
            "contact-relationships",
            "contact-duplicate-candidates",
            "crm-forecast-snapshots",
            "crm-conversations",
            "crm-conversation-messages",
        ] {
            let entry = registry_get(resource).expect("CRM resource must be registered");
            assert!(
                entry.mandatory.iter().any(|field| field == "company_id"),
                "{resource} must project company_id for exact realtime filtering"
            );
        }

        for resource in [
            "leads",
            "lead-sources",
            "lead-lost-reasons",
            "opportunity-stages",
            "contact-tags",
            "contact-categories",
            "contact-segments",
            "assignment-rules",
            "activities",
            "calendar-events",
            "utm-campaigns",
            "utm-media",
            "utm-sources",
            "lead-scores",
            "lead-score-factors",
            "contact-segment-rules",
        ] {
            let entry = registry_get(resource).expect("shared CRM resource must be registered");
            assert!(
                !entry.mandatory.iter().any(|field| field == "company_id"),
                "{resource} is explicitly organization-shared"
            );
        }
    }

    #[test]
    fn crm_resource_classification_is_narrow() {
        assert!(crm_resource("contacts"));
        assert!(crm_resource("crm-conversation-messages"));
        assert!(!crm_resource("account-moves"));
    }

    #[test]
    fn row_id_u64_strict_roundtrips_boundary_values() {
        // 2^53 — largest JS-safe integer
        let at_boundary = json!({ "id": "9007199254740992" });
        assert_eq!(
            row_id_u64_strict(&at_boundary).unwrap(),
            9007199254740992u64
        );

        // 2^53 + 1 — first value that JS Number silently truncates
        let above_boundary = json!({ "id": "9007199254740993" });
        assert_eq!(
            row_id_u64_strict(&above_boundary).unwrap(),
            9007199254740993u64
        );

        // near u64::MAX
        let near_max = json!({ "id": "18446744073709551614" });
        assert_eq!(
            row_id_u64_strict(&near_max).unwrap(),
            18446744073709551614u64
        );

        // numeric form also accepted
        let numeric = json!({ "id": 42u64 });
        assert_eq!(row_id_u64_strict(&numeric).unwrap(), 42u64);
    }

    #[test]
    fn row_id_u64_strict_rejects_bad_inputs() {
        assert!(row_id_u64_strict(&json!({})).is_err(), "missing id field");
        assert!(
            row_id_u64_strict(&json!({ "id": null })).is_err(),
            "null id"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "" })).is_err(),
            "empty string"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "-1" })).is_err(),
            "negative string"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "3.14" })).is_err(),
            "float string"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "not_a_number" })).is_err(),
            "non-numeric string"
        );
    }

    #[test]
    fn optional_u64_returns_ok_none_for_absent_and_null() {
        assert_eq!(optional_u64(None).unwrap(), None);
        assert_eq!(optional_u64(Some(&json!(null))).unwrap(), None);
        assert_eq!(optional_u64(Some(&json!({ "none": [] }))).unwrap(), None);
    }

    #[test]
    fn optional_u64_parses_string_at_boundary_values() {
        let v = json!("9007199254740993");
        assert_eq!(optional_u64(Some(&v)).unwrap(), Some(9007199254740993u64));

        let v2 = json!({ "some": ["18446744073709551614"] });
        assert_eq!(
            optional_u64(Some(&v2)).unwrap(),
            Some(18446744073709551614u64)
        );
    }

    #[test]
    fn optional_u64_errors_on_present_but_unparseable_value() {
        assert!(
            optional_u64(Some(&json!("not_a_number"))).is_err(),
            "non-numeric string should be an error"
        );
        assert!(
            optional_u64(Some(&json!("-5"))).is_err(),
            "negative string should be an error"
        );
        assert!(
            optional_u64(Some(&json!({ "some": ["bad"] }))).is_err(),
            "invalid some value should be an error"
        );
    }

    #[test]
    fn inventory_resource_classification_covers_expected_resources() {
        assert!(inventory_resource("stock-quants"));
        assert!(inventory_resource("stock-pickings"));
        assert!(inventory_resource("warehouses"));
        assert!(inventory_resource("quality-checks"));
        assert!(inventory_resource("replenishment-rules"));
        assert!(inventory_resource("picking-batches"));
        assert!(!inventory_resource("account-moves"));
        assert!(!inventory_resource("contacts"));
    }

    #[test]
    fn accounting_resource_classification_covers_company_scoped_tables() {
        for resource in [
            "account-accounts",
            "account-assets",
            "account-groups",
            "account-journals",
            "account-move-lines",
            "account-moves",
            "account-payments",
            "account-periods",
            "account-reconciliation-widgets",
            "account-taxes",
            "budgets",
            "budget-lines",
            "budget-posts",
            "fiscal-years",
        ] {
            assert!(
                accounting_resource(resource),
                "{resource} backs a required company_id column and must be scoped"
            );
        }
    }

    #[test]
    fn accounting_resource_excludes_org_wide_tables_and_other_domains() {
        // These accounting tables carry no company_id column at all — org-wide by design.
        assert!(!accounting_resource("account-account-types"));
        assert!(!accounting_resource("account-payment-terms"));
        assert!(!accounting_resource("account-payment-term-lines"));
        // Sanity: not misclassified as another domain's resource.
        assert!(!accounting_resource("contacts"));
        assert!(!accounting_resource("stock-quants"));
        assert!(!crm_resource("account-accounts"));
        assert!(!inventory_resource("account-journals"));
        assert!(!purchasing_resource("account-moves"));
    }

    #[test]
    fn accounting_resources_project_company_id_for_row_filtering() {
        for resource in [
            "account-accounts",
            "account-assets",
            "account-groups",
            "account-journals",
            "account-move-lines",
            "account-moves",
            "account-payments",
            "account-periods",
            "account-reconciliation-widgets",
            "account-taxes",
            "budgets",
            "budget-lines",
            "budget-posts",
            "fiscal-years",
        ] {
            let entry = registry_get(resource).expect("accounting resource must be registered");
            let projects_company_id = entry.mandatory.iter().any(|f| f == "company_id")
                || entry.default_restricted.iter().any(|f| f == "company_id");
            assert!(
                projects_company_id,
                "{resource} must project company_id by default for row_company_matches to work"
            );
        }
    }

    #[test]
    fn accounting_company_scoped_rows_filtered_strictly_no_shared_fallback() {
        let mut rows = vec![
            json!({ "id": 1, "companyId": 7 }),
            json!({ "id": 2, "companyId": null }),
            json!({ "id": 3, "companyId": 8 }),
        ];
        rows.retain(|row| row_company_matches(row, 7, false));
        assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
    }
}
