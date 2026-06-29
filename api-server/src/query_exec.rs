//! Execute `/v1/query/:resource` SQL aligned with `frontend/packages/stdb/src/server.ts`.

use std::collections::HashSet;

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
    Ok(company_ids_for_organization(client, org_id, None)
        .await?
        .into_iter()
        .next())
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
        "ai-action-drafts" => {
            let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND proposed_by = {id} ORDER BY id DESC"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "ai-action-drafts-inbox" => {
            // `ai_action_draft` has `organization_id`; `company_id IN (...)` is redundant and
            // SpacetimeDB SQL does not support `IN` clauses. Scope by org only.
            let sql = format!(
                "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND status = 'pending' ORDER BY id DESC"
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
        | "pos-payment-methods"
        | "picking-batches" => {
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
                "SELECT id, organization_id, table_name, file_name, total_rows, imported_rows, error_rows, status, started_at, completed_at, create_uid, create_date, metadata FROM import_job WHERE organization_id = {organization_id} ORDER BY id DESC LIMIT 100"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "import-job-errors" => {
            let sql = format!(
                "SELECT e.id, e.job_id, e.row_number, e.field_name, e.raw_value, e.error_message, e.create_date FROM import_job_error e INNER JOIN import_job j ON e.job_id = j.id WHERE j.organization_id = {organization_id} ORDER BY e.id DESC LIMIT 500"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
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
        _ => {}
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
        "landed-costs" => " ORDER BY id DESC",
        "landed-cost-lines" => " ORDER BY landed_cost_id ASC, id ASC",
        "contact-tags" => "",
        "contact-segments" => "",
        "quality-alerts" => "",
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

    match resource {
        "contact-tags" | "contact-segments" => {
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
        "activities" => {
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
