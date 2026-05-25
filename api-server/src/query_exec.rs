//! Execute `/v1/query/:resource` SQL aligned with `frontend/packages/stdb/src/server.ts`.

use serde_json::Value;

use crate::error::ApiError;
use stdb_auth::{
    identity_sql_literal, registry_get, resolve_http_sql_columns, select_company_scoped_sql,
    select_org_scoped_sql, FieldAccessContext,
};
use stdb_client::StdbClient;

fn row_not_soft_deleted(r: &Value) -> bool {
    r.get("deletedAt").map(|v| v.is_null()).unwrap_or(true)
}

async fn company_ids_for_organization(
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
    let sql = format!("SELECT id FROM company WHERE organization_id = {org_id} LIMIT 1");
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(rows.first().and_then(|r| r.get("id")).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    }))
}

pub async fn execute_resource_query(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let fa = field_access;

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
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let col = resolve_http_sql_columns("account-assets", fa).map_err(ApiError::Internal)?;
            let list = ids
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT {} FROM account_asset WHERE company_id IN ({list})",
                col.join(", ")
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "depreciation-lines" => {
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let list = ids
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let id_rows = client
                .query_sql(&format!(
                    "SELECT id FROM account_asset WHERE company_id IN ({list})"
                ))
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let mut asset_ids: Vec<u64> = Vec::new();
            for r in id_rows {
                if let Some(id) = r.get("id").and_then(|v| v.as_u64()).or_else(|| {
                    r.get("id")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse().ok())
                }) {
                    if id > 0 {
                        asset_ids.push(id);
                    }
                }
            }
            if asset_ids.is_empty() {
                return Ok(vec![]);
            }
            let col =
                resolve_http_sql_columns("depreciation-lines", fa).map_err(ApiError::Internal)?;
            let alist = asset_ids
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT {} FROM account_asset_depreciation_line WHERE asset_id IN ({alist})",
                col.join(", ")
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "intercompany-rules" => {
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let col =
                resolve_http_sql_columns("intercompany-rules", fa).map_err(ApiError::Internal)?;
            let list = ids
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT {} FROM intercompany_rule WHERE source_company_id IN ({list}) OR destination_company_id IN ({list}) ORDER BY sequence ASC",
                col.join(", ")
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "intercompany-transactions" => {
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            if ids.is_empty() {
                return Ok(vec![]);
            }
            let col = resolve_http_sql_columns("intercompany-transactions", fa)
                .map_err(ApiError::Internal)?;
            let list = ids
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT {} FROM intercompany_transaction WHERE origin_company_id IN ({list}) OR destination_company_id IN ({list}) ORDER BY id DESC",
                col.join(", ")
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "ai-insights" => {
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            let col = resolve_http_sql_columns("ai-insights", fa).map_err(ApiError::Internal)?;
            let sql = if ids.is_empty() {
                format!(
                    "SELECT {} FROM ai_insight WHERE company_id IS NULL",
                    col.join(", ")
                )
            } else {
                let list = ids
                    .iter()
                    .map(|x| x.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "SELECT {} FROM ai_insight WHERE company_id IN ({list}) OR company_id IS NULL",
                    col.join(", ")
                )
            };
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "ai-document-processing-jobs" => {
            let ids = company_ids_for_organization(client, organization_id, fa).await?;
            let col = resolve_http_sql_columns("ai-document-processing-jobs", fa)
                .map_err(ApiError::Internal)?;
            let sql = if ids.is_empty() {
                format!(
                    "SELECT {} FROM ai_document_processing_job WHERE company_id IS NULL",
                    col.join(", ")
                )
            } else {
                let list = ids
                    .iter()
                    .map(|x| x.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "SELECT {} FROM ai_document_processing_job WHERE company_id IN ({list}) OR company_id IS NULL",
                    col.join(", ")
                )
            };
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
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
        "fiscal-years" | "account-periods" => {
            let Some(cid) = default_company_id(client, organization_id).await? else {
                return Ok(vec![]);
            };
            let reg = registry_get(resource)
                .ok_or_else(|| ApiError::NotFound(format!("unknown resource: {resource}")))?;
            let sql = select_company_scoped_sql(resource, &reg.table, cid, fa, "", "")
                .map_err(ApiError::Internal)?;
            let rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let mut out: Vec<Value> = rows.into_iter().collect();
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
        _ => {}
    }

    let Some(reg) = registry_get(resource) else {
        return Err(ApiError::NotFound(format!(
            "Unknown resource: \"{resource}\""
        )));
    };

    let order = match resource {
        "opportunity-stages" => " ORDER BY sequence ASC",
        "activities" => " ORDER BY id DESC",
        "pricelist-items" => " ORDER BY pricelist_id ASC, sequence ASC",
        "pos-loyalty-programs" => " ORDER BY id DESC",
        "landed-costs" => " ORDER BY id DESC",
        "mrp-bom-lines" => " ORDER BY bom_id ASC, sequence ASC",
        "mrp-routing-workcenters" => " ORDER BY workcenter_id ASC, sequence ASC",
        "calendar-events" => " ORDER BY start ASC",
        "deferred-revenue-schedules" => " ORDER BY id DESC",
        "deferred-revenue-lines" => " ORDER BY schedule_id ASC, sequence ASC",
        "revenue-recognition-rules" => " ORDER BY priority DESC, id DESC",
        "workflow-activities" => " ORDER BY workflow_id ASC, sequence ASC",
        "workflow-transitions" => " ORDER BY id ASC",
        "workflow-workitems" => " ORDER BY instance_id ASC, id ASC",
        _ => "",
    };

    let sql = select_org_scoped_sql(resource, &reg.table, organization_id, fa, "", order)
        .map_err(ApiError::Internal)?;

    let mut rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    if resource == "activities" {
        rows.retain(|r| row_not_soft_deleted(r));
    }
    if resource == "companies" {
        rows.retain(|r| row_not_soft_deleted(r));
    }

    Ok(rows)
}
