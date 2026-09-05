//! Accounting reads with their existing organization and parent-company scope checks.

use super::company_scope::company_ids_for_organization;
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::{
    registry_get, resolve_http_sql_columns, select_company_scoped_sql, select_org_scoped_sql,
    FieldAccessContext,
};
use stdb_client::StdbClient;

pub(super) async fn read_fiscal_years(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
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
        let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

pub(super) async fn read_intercompany_transactions(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
    // rows and filter by `origin_company_id`/`destination_company_id` in Rust.
    let ids = company_ids_for_organization(client, organization_id, fa).await?;
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let company_set: HashSet<u64> = ids.iter().copied().collect();
    let col =
        resolve_http_sql_columns("intercompany-transactions", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM intercompany_transaction", col.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

pub(super) async fn read_intercompany_rules(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    // No `organization_id`; SpacetimeDB SQL does not support `IN (...)`. Fetch all
    // rows and filter by `source_company_id`/`destination_company_id` in Rust.
    let ids = company_ids_for_organization(client, organization_id, fa).await?;
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let company_set: HashSet<u64> = ids.iter().copied().collect();
    let col = resolve_http_sql_columns("intercompany-rules", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM intercompany_rule", col.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
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

pub(super) async fn read_depreciation_lines(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
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
        .map_err(ApiError::internal)?;
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

    let col = resolve_http_sql_columns("depreciation-lines", fa).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT {} FROM account_asset_depreciation_line",
        col.join(", ")
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(|r| {
        r.get("assetId")
            .or_else(|| r.get("asset_id"))
            .and_then(|v| v.as_u64())
            .is_some_and(|id| asset_set.contains(&id))
    });
    return Ok(rows);
}

pub(super) async fn read_account_assets(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    // `account_asset` has no `organization_id`; SpacetimeDB SQL does not support
    // `IN (...)`. Fetch all rows and filter by `company_id` in Rust.
    let ids = company_ids_for_organization(client, organization_id, fa).await?;
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let company_set: HashSet<u64> = ids.iter().copied().collect();
    let col = resolve_http_sql_columns("account-assets", fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM account_asset", col.join(", "));
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(|r| {
        r.get("companyId")
            .or_else(|| r.get("company_id"))
            .and_then(|v| v.as_u64())
            .is_some_and(|cid| company_set.contains(&cid))
    });
    return Ok(rows);
}

pub(super) async fn read_account_payment_term_lines(
    client: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
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
        .map_err(ApiError::internal)?;
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
    let col =
        resolve_http_sql_columns("account-payment-term-lines", fa).map_err(ApiError::Internal)?;
    let or_clause = term_ids
        .iter()
        .map(|id| format!("payment_term_id = {id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT {} FROM account_payment_term_line WHERE {or_clause}",
        col.join(", ")
    );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(super) async fn read_consolidation_elimination_entries(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
    accounting_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let col = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
    let company_id = accounting_company_id.ok_or_else(|| {
        ApiError::Internal(
            "consolidation elimination entries require accounting company scope".into(),
        )
    })?;
    let sql = format!(
                "SELECT {} FROM consolidation_elimination_entry WHERE organization_id = {organization_id} AND company_id = {company_id}",
                col.join(", ")
            );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(super) async fn read_consolidation_journals(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let col = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT {} FROM consolidation_journal WHERE organization_id = {organization_id}",
        col.join(", ")
    );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}

pub(super) async fn read_consolidation_accounts(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let col = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT {} FROM consolidation_account WHERE organization_id = {organization_id}",
        col.join(", ")
    );
    return client.query_sql(&sql).await.map_err(ApiError::internal);
}
