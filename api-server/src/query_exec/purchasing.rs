//! Scoped purchasing query handlers.

use super::row_company_matches;
use super::row_values::row_enum_tag_is;
use super::row_values::row_id_u64;
use super::row_values::row_u64;
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::registry_get;
use stdb_auth::select_org_and_company_scoped_sql;
use stdb_auth::select_org_scoped_sql;
use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

pub(super) async fn read_landed_cost_lines(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
    purchasing_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let company_id = purchasing_company_id
        .ok_or_else(|| ApiError::Internal("purchasing company id not resolved".into()))?;
    let cost_rows = client
                .query_sql(&format!(
                    "SELECT id, company_id FROM stock_landed_cost WHERE organization_id = {organization_id} AND company_id = {company_id}"
                ))
                .await
                .map_err(ApiError::internal)?;
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
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

pub(super) async fn read_purchase_orders_to_approve(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
    purchasing_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
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
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(|row| row_enum_tag_is(row, "state", &["ToApprove"]));
    return Ok(rows);
}

pub(super) async fn read_partner_banks(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
    purchasing_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let registry = registry_get(resource)
        .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
    let company_id = purchasing_company_id
        .ok_or_else(|| ApiError::Internal("purchasing company id not resolved".into()))?;
    let sql = select_org_scoped_sql(resource, &registry.table, organization_id, fa, "", "")
        .map_err(ApiError::Internal)?;
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(|row| row_company_matches(row, company_id, true));
    return Ok(rows);
}
