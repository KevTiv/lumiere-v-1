//! SQL helpers mirroring `frontend/packages/stdb/src/server.ts` (not generic `/v1/query`).

use serde_json::Value;
use std::collections::HashSet;

use crate::error::ApiError;
use crate::session::normalize_identity_hex_for_sql;
use stdb_auth::{identity_sql_literal, resolve_http_sql_columns, FieldAccessContext};
use stdb_client::StdbClient;

fn membership_user_identity_hex(m: &Value) -> Option<String> {
    let raw = m.get("userIdentity").or_else(|| m.get("user_identity"))?;
    if let Some(s) = raw.as_str() {
        let n = normalize_identity_hex_for_sql(s);
        if n.len() == 64 {
            return Some(n);
        }
        return None;
    }
    None
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
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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
        .map_err(ApiError::internal)?;
    if memberships.is_empty() {
        return Ok(vec![]);
    }

    let mut seen = HashSet::new();
    let mut unique_ids: Vec<String> = Vec::new();
    for m in &memberships {
        if let Some(id) = membership_user_identity_hex(m) {
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
        let lit = identity_sql_literal(&unique_ids[0]).map_err(ApiError::Internal)?;
        format!("identity = {lit}")
    } else {
        format!(
            "({})",
            unique_ids
                .iter()
                .map(|id| {
                    identity_sql_literal(id)
                        .map(|lit| format!("identity = {lit}"))
                        .map_err(|e| e.to_string())
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(ApiError::Internal)?
                .join(" OR ")
        )
    };
    let sql = format!("SELECT {col_p} FROM user_profile WHERE {where_clause}");
    client.query_sql(&sql).await.map_err(ApiError::internal)
}
