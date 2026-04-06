//! SQL helpers mirroring `frontend/packages/stdb/src/server.ts` (not generic `/v1/query`).

use serde_json::Value;
use std::collections::HashSet;

use crate::error::ApiError;
use stdb_auth::{resolve_http_sql_columns, FieldAccessContext};
use stdb_client::StdbClient;

fn sql_esc(s: &str) -> String {
    s.replace('\'', "''")
}

pub async fn query_lead_by_id(
    client: &StdbClient,
    lead_id: u64,
    org_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Option<Value>, ApiError> {
    let cols = resolve_http_sql_columns("leads", fa).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT {} FROM lead WHERE id = {lead_id} AND organization_id = {org_id} LIMIT 1",
        cols.join(", ")
    );
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(rows.into_iter().next())
}

pub async fn query_org_users(
    client: &StdbClient,
    org_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let col_uo = resolve_http_sql_columns("user-organization", fa)
        .map_err(ApiError::Internal)?
        .join(", ");
    let memberships = client
        .query_sql(&format!(
            "SELECT {col_uo} FROM user_organization WHERE organization_id = {org_id} AND is_active = true"
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if memberships.is_empty() {
        return Ok(vec![]);
    }

    let mut seen = HashSet::new();
    let mut unique_ids: Vec<String> = Vec::new();
    for m in &memberships {
        let id = m
            .get("userIdentity")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .or_else(|| {
                m.get("userIdentity")
                    .and_then(|v| v.as_u64().map(|n| n.to_string()))
            });
        if let Some(id) = id {
            if seen.insert(id.clone()) {
                unique_ids.push(id);
            }
        }
    }
    if unique_ids.is_empty() {
        return Ok(vec![]);
    }

    let col_p = resolve_http_sql_columns("user-profile", fa)
        .map_err(ApiError::Internal)?
        .join(", ");
    let where_clause = if unique_ids.len() == 1 {
        format!("identity = '{}'", sql_esc(&unique_ids[0]))
    } else {
        format!(
            "({})",
            unique_ids
                .iter()
                .map(|id| format!("identity = '{}'", sql_esc(id)))
                .collect::<Vec<_>>()
                .join(" OR ")
        )
    };
    let sql = format!("SELECT {col_p} FROM user_profile WHERE {where_clause}");
    client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))
}
