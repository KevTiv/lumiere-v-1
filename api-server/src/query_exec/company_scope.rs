//! Membership-derived company scope and resource classification.

use super::row_values::{row_not_soft_deleted, row_u64};
use crate::error::ApiError;
use stdb_auth::{identity_sql_literal, select_org_scoped_sql, FieldAccessContext};
use stdb_client::StdbClient;

pub(crate) fn enforce_requested_company(
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
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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
    resolve_membership_company_id(
        client,
        organization_id,
        identity_hex,
        requested_company_id,
        "Cannot query another company's CRM data",
    )
    .await
}

/// Resolve the POS/sales company from the authenticated membership before a
/// hot or durable read is planned. Browser company selection is actor intent,
/// never durable-store scope authority.
pub async fn resolve_sales_company_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
) -> Result<u64, ApiError> {
    resolve_membership_company_id(
        client,
        organization_id,
        identity_hex,
        requested_company_id,
        "Cannot query another company's sales data",
    )
    .await
}

pub(crate) async fn resolve_membership_company_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
    denied_message: &str,
) -> Result<u64, ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT id, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true"
    );
    let memberships = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

    enforce_requested_company(allowed, requested_company_id, denied_message)
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
    let memberships = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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
    let memberships = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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
    let memberships = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

/// Resolve the only IoT company visible to this authenticated membership.
///
/// Every IoT table carries a required `company_id`, including pairing tokens.
/// Organization-level memberships fall back to the default company; an explicit
/// browser company remains actor intent and must match that server-derived scope.
pub async fn resolve_iot_company_id(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    requested_company_id: Option<u64>,
) -> Result<u64, ApiError> {
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT id, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {organization_id} AND user_identity = {identity} AND is_active = true"
    );
    let memberships = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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
        "Cannot query another company's IoT data",
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
/// `company_id`.
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
            | "amortization-lines"
            | "amortization-schedules"
            | "analytic-accounts"
            | "analytic-distribution-models"
            | "analytic-lines"
            | "bank-statements"
            | "budgets"
            | "budget-lines"
            | "budget-posts"
            | "consolidation-elimination-entries"
            | "depreciation-lines"
            | "fiscal-years"
            | "fixed-assets"
            | "fx-revaluation-runs"
            | "partner-credit-controls"
            | "partner-credit-holds"
            | "payment-accounts"
            | "payment-fees"
            | "payment-reconciliations"
            | "payment-reversals"
            | "payment-transactions"
            | "tax-deadlines"
            | "tax-groups"
            | "tax-schedules"
    )
}

/// Accounting resources whose rows are either owned by the selected company
/// or explicitly shared inside the organization with a null `company_id`.
pub(crate) fn optional_company_accounting_resource(resource: &str) -> bool {
    matches!(resource, "account-account-types")
}

pub(crate) fn iot_resource(resource: &str) -> bool {
    matches!(
        resource,
        "iot-actions"
            | "iot-alerts"
            | "iot-devices"
            | "iot-hubs"
            | "iot-pairing-tokens"
            | "iot-telemetry"
            | "iot-thresholds"
    )
}
