//! Scoped forms query handlers.

use super::row_values::row_id_u64_strict;
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::resolve_http_sql_columns;
use stdb_auth::select_org_scoped_sql;
use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

pub(super) async fn read_form_config_fields(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let config_sql =
        select_org_scoped_sql("form-configs", "form_config", organization_id, fa, "", "")
            .map_err(ApiError::Internal)?;
    let config_rows = client
        .query_sql(&config_sql)
        .await
        .map_err(ApiError::internal)?;
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
    let cols = resolve_http_sql_columns("form-config-fields", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM form_config_field", cols.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

pub(super) async fn read_form_role_configs(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let config_sql =
        select_org_scoped_sql("form-configs", "form_config", organization_id, fa, "", "")
            .map_err(ApiError::Internal)?;
    let config_rows = client
        .query_sql(&config_sql)
        .await
        .map_err(ApiError::internal)?;
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
    let cols = resolve_http_sql_columns("form-role-configs", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM form_role_config", cols.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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
