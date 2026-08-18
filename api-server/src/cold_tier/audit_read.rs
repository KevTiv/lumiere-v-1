//! Audit-log read merge: `cold_audit_log` (PG) ∪ `audit_log` (STDB tail).
//!
//! Implements `docs/plans/audit-log-cold-by-default.md` §6/§6.1: the existing
//! `audit-log` resource contract is already bounded (`id DESC`, no cursor,
//! top 500 — see the consumer inventory in that doc), so the merge here
//! reuses that exact contract rather than introducing pagination.
//!
//! Row shape parity matters: `StdbClient::query_sql` returns hot rows with
//! camelCase keys, raw JSON numbers for u64 columns, and
//! `{"microsSinceUnixEpoch": <i64>}` for `timestamp` (see
//! `crates/stdb-client`'s SATS-JSON unwrapping). `cold_audit_log`'s columns
//! are NUMERIC/BIGINT and would naturally decode as decimal strings — this
//! module reconstructs cold rows into the exact hot shape instead, per the
//! plan's invariant that "existing callers remain unchanged" (frontend
//! compatibility is non-negotiable, not just a nice-to-have).

use std::collections::HashSet;

use serde_json::{json, Value};
use stdb_client::StdbClient;

use crate::error::ApiError;
use crate::metrics;

use super::pg_pool;

const HOT_COLUMNS: &str = "id, organization_id, company_id, table_name, record_id, action, \
                            old_values, new_values, session_id, ip_address, user_agent, timestamp";

/// Merge cold + hot audit-log rows for `organization_id`, in the same shape
/// and bound (`id DESC`, top 500) the hot-only endpoint has always returned.
///
/// If the cold (PG) read fails, this does not fail the request — it falls
/// back to the hot tail alone and bumps `audit_cold_read_failures_total`, so
/// the failure is observable (alertable) without silently claiming the
/// result is complete history the way a swallowed error would.
pub async fn merged_rows(stdb: &StdbClient, organization_id: u64) -> Result<Vec<Value>, ApiError> {
    let hot_sql =
        format!("SELECT {HOT_COLUMNS} FROM audit_log WHERE organization_id = {organization_id}");
    let hot_rows = stdb
        .query_sql(&hot_sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let hot_ids: HashSet<u64> = hot_rows.iter().filter_map(hot_row_id).collect();

    let mut cold_rows = match query_cold_rows(organization_id).await {
        Ok(rows) => rows,
        Err(error) => {
            metrics::inc_audit_cold_read_failure();
            tracing::error!(%error, organization_id, "audit-log cold read failed; falling back to hot tail only");
            Vec::new()
        }
    };
    // The finalize race window (drainer UPSERTed to PG, STDB row not yet
    // deleted) can put the same id in both stores briefly; prefer hot, since
    // it's the current authoritative copy until finalize completes.
    cold_rows.retain(|row| !hot_ids.contains(&hot_row_id(row).unwrap_or(u64::MAX)));

    let mut merged = hot_rows;
    merged.extend(cold_rows);
    merged.sort_by(|a, b| hot_row_id(b).cmp(&hot_row_id(a)));
    merged.truncate(500);

    Ok(merged)
}

fn hot_row_id(row: &Value) -> Option<u64> {
    row.get("id").and_then(|v| v.as_u64())
}

async fn query_cold_rows(organization_id: u64) -> anyhow::Result<Vec<Value>> {
    let Some(pool) = pg_pool::shared_pool() else {
        return Ok(Vec::new());
    };
    let client = pool.get().await?;
    let sql = format!(
        "SELECT id::TEXT, organization_id::TEXT, company_id::TEXT, table_name, record_id::TEXT, \
                action, old_values, new_values, session_id::TEXT, ip_address, user_agent, timestamp \
         FROM cold_audit_log WHERE organization_id = $1::NUMERIC ORDER BY id DESC LIMIT 500"
    );
    let rows = client.query(&sql, &[&organization_id.to_string()]).await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let id: String = row.try_get("id")?;
        let organization_id: String = row.try_get("organization_id")?;
        let company_id: Option<String> = row.try_get("company_id")?;
        let table_name: String = row.try_get("table_name")?;
        let record_id: String = row.try_get("record_id")?;
        let action: String = row.try_get("action")?;
        let old_values: Option<String> = row.try_get("old_values")?;
        let new_values: Option<String> = row.try_get("new_values")?;
        let session_id: Option<String> = row.try_get("session_id")?;
        let ip_address: Option<String> = row.try_get("ip_address")?;
        let user_agent: Option<String> = row.try_get("user_agent")?;
        let timestamp_micros: i64 = row.try_get("timestamp")?;

        out.push(json!({
            "id": decimal_str_to_u64_json(&id)?,
            "organizationId": decimal_str_to_u64_json(&organization_id)?,
            "companyId": company_id.map(|v| decimal_str_to_u64_json(&v)).transpose()?,
            "tableName": table_name,
            "recordId": decimal_str_to_u64_json(&record_id)?,
            "action": action,
            "oldValues": old_values,
            "newValues": new_values,
            "sessionId": session_id.map(|v| decimal_str_to_u64_json(&v)).transpose()?,
            "ipAddress": ip_address,
            "userAgent": user_agent,
            "timestamp": { "microsSinceUnixEpoch": timestamp_micros },
        }));
    }
    Ok(out)
}

/// Parse a NUMERIC(20,0)-as-text column back into a JSON number, matching
/// the raw-number shape `query_sql` produces for hot u64 columns. Errors
/// loudly on anything that doesn't parse rather than defaulting to `0`.
fn decimal_str_to_u64_json(s: &str) -> anyhow::Result<Value> {
    let n: u64 = s.parse()?;
    Ok(json!(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_str_parses_to_number() {
        assert_eq!(decimal_str_to_u64_json("42").unwrap(), json!(42));
    }

    #[test]
    fn decimal_str_rejects_garbage_instead_of_defaulting() {
        assert!(decimal_str_to_u64_json("not-a-number").is_err());
    }

    #[test]
    fn hot_ids_are_preferred_over_cold_duplicates() {
        let hot = vec![json!({"id": 5}), json!({"id": 3})];
        let hot_ids: HashSet<u64> = hot.iter().filter_map(hot_row_id).collect();
        let mut cold = vec![json!({"id": 5}), json!({"id": 1})];
        cold.retain(|row| !hot_ids.contains(&hot_row_id(row).unwrap_or(u64::MAX)));
        assert_eq!(cold, vec![json!({"id": 1})]);
    }
}
