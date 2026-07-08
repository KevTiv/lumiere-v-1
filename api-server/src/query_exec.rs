//! Execute `/v1/query/:resource` SQL via `stdb-auth` resource registry + special cases.
//! Non-registry virtual resources are allowlisted in `crates/stdb-auth/assets/query_exec_non_registry.json`
//! (validated by `make codegen` / `lumiere-codegen`).

use std::collections::HashSet;

use serde_json::Value;

use crate::error::ApiError;
use stdb_auth::{
    identity_sql_literal, registry_get, resolve_http_sql_columns, select_company_scoped_sql,
    select_org_scoped_sql, FieldAccessContext,
};
use stdb_client::StdbClient;

fn row_not_soft_deleted(r: &Value) -> bool {
    match r.get("deletedAt").or_else(|| r.get("deleted_at")) {
        None | Some(Value::Null) => true,
        Some(Value::Object(obj)) if obj.contains_key("none") => true,
        Some(_) => false,
    }
}

fn strip_soft_delete_fields(row: &mut Value) {
    if let Value::Object(map) = row {
        map.remove("deletedAt");
        map.remove("deleted_at");
    }
}

fn filter_and_strip_soft_deleted(rows: &mut Vec<Value>) {
    rows.retain(|r| row_not_soft_deleted(r));
    for row in rows.iter_mut() {
        strip_soft_delete_fields(row);
    }
}

fn row_id_u64(row: &Value) -> u64 {
    row.get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            row.get("id")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0)
}

fn sort_rows_by_id_desc(rows: &mut [Value]) {
    rows.sort_by(|a, b| row_id_u64(b).cmp(&row_id_u64(a)));
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
                "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND proposed_by = {id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-agent-runs" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, skill_id, run_key, status, summary, step_count, error_message, started_at, completed_at, create_date, write_date FROM ai_agent_run WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "ai-action-drafts-inbox" => {
            // `ai_action_draft` has `organization_id`; `company_id IN (...)` is redundant and
            // SpacetimeDB SQL does not support `IN` clauses. Scope by org only.
            // HTTP SQL also rejects `ORDER BY id DESC` on this table — sort in Rust.
            let sql = format!(
                "SELECT id, organization_id, company_id, status, reducer_name, params_json, summary, confidence, elevated, warnings_json, source_query, ui_context_json, proposed_by, reviewed_by, reviewed_at, reject_reason, executed_at, execution_error, execution_record_id, expires_at, create_date, write_date, metadata FROM ai_action_draft WHERE organization_id = {organization_id} AND status = 'pending'"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "approval-requests-inbox" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, rule_id, model, res_id, action, params_json, status, summary, context_json, requested_by, requested_at, reviewed_by, reviewed_at, reject_reason, reviewer_comment, ai_draft_id, workflow_instance_id, create_date, write_date, metadata FROM approval_request WHERE organization_id = {organization_id} AND status = 'pending'"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "approval-rules" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, name, description, model, action, rule_type, threshold, approver_role_id, sequence, is_active, create_date, write_date, metadata FROM approval_rule WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "document-templates" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, name, model, report_type, body_html, header_html, footer_html, variable_bindings_json, is_default, is_active, create_date, write_date, metadata FROM document_template WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "mail-templates" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, name, model, subject, body_html, document_template_id, attach_document, is_default, is_active, create_date, write_date, metadata FROM mail_template WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "queued-mail-messages" => {
            let sql = format!(
                "SELECT id, organization_id, model, res_id, author_id, body, message_type, subtype, date, parent_id, attachment_ids, metadata FROM mail_message WHERE organization_id = {organization_id} AND message_type = 'Email'"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            rows.retain(|row| {
                row.get("metadata")
                    .and_then(|v| v.as_str())
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .and_then(|meta| meta.get("delivery").and_then(|d| d.as_str()).map(|d| d == "queued"))
                    .unwrap_or(false)
            });
            return Ok(rows);
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
                "SELECT id, organization_id, table_name, file_name, total_rows, imported_rows, error_rows, status, started_at, completed_at, create_uid, create_date, metadata FROM import_job WHERE organization_id = {organization_id} LIMIT 200"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            rows.truncate(100);
            return Ok(rows);
        }
        "import-job-errors" => {
            let job_sql = format!(
                "SELECT id FROM import_job WHERE organization_id = {organization_id} LIMIT 200"
            );
            let job_rows = client
                .query_sql(&job_sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let job_ids: Vec<u64> = job_rows.iter().map(row_id_u64).filter(|id| *id > 0).collect();
            if job_ids.is_empty() {
                return Ok(vec![]);
            }
            let id_list = job_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT id, job_id, row_number, field_name, raw_value, error_message, create_date FROM import_job_error WHERE job_id IN ({id_list}) LIMIT 500"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "form-config-fields" => {
            let config_sql =
                select_org_scoped_sql("form-configs", "form_config", organization_id, fa, "", "")
                    .map_err(ApiError::Internal)?;
            let config_rows = client
                .query_sql(&config_sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let config_ids: HashSet<u64> = config_rows
                .iter()
                .filter_map(|r| {
                    let id = row_id_u64(r);
                    (id > 0).then_some(id)
                })
                .collect();
            if config_ids.is_empty() {
                return Ok(vec![]);
            }
            let cols = resolve_http_sql_columns("form-config-fields", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM form_config_field", cols.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
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
        "form-role-configs" => {
            let config_sql =
                select_org_scoped_sql("form-configs", "form_config", organization_id, fa, "", "")
                    .map_err(ApiError::Internal)?;
            let config_rows = client
                .query_sql(&config_sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let config_ids: HashSet<u64> = config_rows
                .iter()
                .filter_map(|r| {
                    let id = row_id_u64(r);
                    (id > 0).then_some(id)
                })
                .collect();
            if config_ids.is_empty() {
                return Ok(vec![]);
            }
            let cols = resolve_http_sql_columns("form-role-configs", fa).map_err(ApiError::Internal)?;
            let sql = format!("SELECT {} FROM form_role_config", cols.join(", "));
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
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
        "import-mapping-templates" => {
            let sql = format!(
                "SELECT id, organization_id, table_name, name, mapping_json, use_count, create_uid, create_date, write_uid, write_date FROM import_mapping_template WHERE organization_id = {organization_id} ORDER BY use_count DESC, id DESC LIMIT 200"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "audit-log" => {
            let sql = format!(
                "SELECT id, organization_id, company_id, table_name, record_id, action, old_values, new_values, session_id, ip_address, user_agent, timestamp FROM audit_log WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            rows.truncate(500);
            return Ok(rows);
        }
        "audit-rules" => {
            let sql = format!(
                "SELECT id, organization_id, table_name, log_reads, log_writes, log_deletes, log_logins, is_active FROM audit_rule WHERE organization_id = {organization_id}"
            );
            let mut rows = client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            sort_rows_by_id_desc(&mut rows);
            return Ok(rows);
        }
        "org-permissions" => {
            let sql = format!(
                "SELECT id, organization_id, subject, role_id, resource, action, effect, created_by, created_at FROM org_permission WHERE organization_id = {organization_id}"
            );
            return client
                .query_sql(&sql)
                .await
                .map_err(|e| ApiError::Internal(e.to_string()));
        }
        "policy-snapshots" => {
            let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
            let sql = format!(
                "SELECT id, organization_id, user_identity, role_id, role_name, role_permissions, org_permission_grants, field_permissions, is_superuser, version_hash, refreshed_at FROM policy_snapshot WHERE organization_id = {organization_id} AND user_identity = {id}"
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

    if resource == "activities"
        || resource == "companies"
        || resource == "contacts"
        || resource == "leads"
        || resource == "product-categories"
    {
        filter_and_strip_soft_deleted(&mut rows);
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn row_not_soft_deleted_treats_missing_and_null_as_live() {
        assert!(row_not_soft_deleted(&json!({ "id": 1 })));
        assert!(row_not_soft_deleted(&json!({ "id": 1, "deletedAt": null })));
        assert!(row_not_soft_deleted(
            &json!({ "id": 1, "deleted_at": { "none": [] } })
        ));
    }

    #[test]
    fn row_not_soft_deleted_rejects_timestamp() {
        assert!(!row_not_soft_deleted(&json!({
            "id": 1,
            "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 }
        })));
    }

    #[test]
    fn filter_and_strip_soft_deleted_removes_deleted_rows_and_field() {
        let mut rows = vec![
            json!({ "id": 1, "deletedAt": null }),
            json!({ "id": 2, "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 } }),
        ];
        filter_and_strip_soft_deleted(&mut rows);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("id").and_then(|v| v.as_u64()), Some(1));
        assert!(rows[0].get("deletedAt").is_none());
    }
}
