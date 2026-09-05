//! Scoped inventory query handlers.

use super::company_scope::company_ids_for_organization;
use super::company_scope::default_company_id;
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::registry_get;
use stdb_auth::resolve_http_sql_columns;
use stdb_auth::select_company_scoped_sql;
use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

pub(super) async fn read_pos_configs(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let ids = company_ids_for_organization(client, organization_id, fa).await?;
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let company_set: HashSet<u64> = ids.iter().copied().collect();
    let col = resolve_http_sql_columns("pos-configs", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM pos_config", col.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

pub(super) async fn read_pos_sessions(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
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
        .map_err(ApiError::internal)?;
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
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

pub(super) async fn read_delivery_carriers(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let Some(cid) = default_company_id(client, organization_id).await? else {
        return Ok(vec![]);
    };
    let reg = registry_get(resource)
        .ok_or_else(|| ApiError::NotFound(format!("unknown resource: {resource}")))?;
    let sql = select_company_scoped_sql(resource, &reg.table, cid, fa, "", "")
        .map_err(ApiError::Internal)?;
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(super) async fn read_picking_batches(
    client: &StdbClient,
    resource: &str,
    fa: Option<&FieldAccessContext>,
    inventory_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    // inventory_company_id is already resolved for this resource above
    let cid = inventory_company_id.expect("picking-batches is an inventory resource");
    let reg = registry_get(resource)
        .ok_or_else(|| ApiError::NotFound(format!("unknown resource: {resource}")))?;
    let sql = select_company_scoped_sql(resource, &reg.table, cid, fa, "", "")
        .map_err(ApiError::Internal)?;
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}
