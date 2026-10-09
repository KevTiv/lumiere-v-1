//! Accounting reads with their existing organization and parent-company scope checks.

use super::company_scope::{accounting_read_permission_resource, company_ids_for_organization};
use super::row_values::{row_not_soft_deleted, row_u64};
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::{
    has_resource_read_permission, registry_get, resolve_http_sql_columns,
    select_company_scoped_sql, select_org_scoped_sql, FieldAccessContext,
};
use stdb_client::StdbClient;

#[derive(Clone, Copy)]
struct AccountingChildScope {
    table: &'static str,
    parent_table: &'static str,
    parent_column: &'static str,
    parent_camel: &'static str,
    nullable_relation: bool,
}

impl AccountingChildScope {
    fn for_resource(resource: &str) -> Result<Self, ApiError> {
        match resource {
            "bank-statement-import-lines" => Ok(Self {
                table: "bank_statement_import_line",
                parent_table: "bank_statement_import",
                parent_column: "import_id",
                parent_camel: "importId",
                nullable_relation: false,
            }),
            "tax-deadline-reminders" => Ok(Self {
                table: "tax_deadline_reminder",
                parent_table: "tax_deadline",
                parent_column: "tax_deadline_id",
                parent_camel: "taxDeadlineId",
                nullable_relation: true,
            }),
            _ => Err(ApiError::NotFound(format!(
                "unknown accounting child resource: {resource}"
            ))),
        }
    }

    fn parent_sql(self, organization_id: u64, company_id: u64) -> String {
        if self.nullable_relation {
            // tax_deadline.company_id is Option<u64>: HTTP SQL cannot compare
            // it to a scalar. Decode and validate it in Rust, never widen scope.
            format!(
                "SELECT id, organization_id, company_id, deleted_at FROM {} WHERE organization_id = {organization_id}",
                self.parent_table
            )
        } else {
            // The import owns company scope even before approval; its optional
            // approved_statement_id is not an authorization parent.
            format!(
                "SELECT id, organization_id, company_id FROM {} WHERE organization_id = {organization_id} AND company_id = {company_id}",
                self.parent_table
            )
        }
    }

    fn child_sql(
        self,
        organization_id: u64,
        columns: &[String],
        parent_ids: &HashSet<u64>,
    ) -> String {
        let mut sql = format!(
            "SELECT {} FROM {} WHERE organization_id = {organization_id}",
            columns.join(", "),
            self.table
        );
        if !self.nullable_relation {
            // No IN support in SpacetimeDB HTTP SQL. Required import_id can be
            // scoped in SQL; optional tax_deadline_id must be decoded in Rust.
            let mut ids: Vec<_> = parent_ids.iter().copied().collect();
            ids.sort_unstable();
            let predicates = ids
                .iter()
                .map(|id| format!("{} = {id}", self.parent_column))
                .collect::<Vec<_>>()
                .join(" OR ");
            sql.push_str(&format!(" AND ({predicates})"));
        }
        sql
    }
}

fn accounting_parent_ids(rows: &[Value], organization_id: u64, company_id: u64) -> HashSet<u64> {
    rows.iter()
        .filter(|row| {
            accounting_row_id(row, "organizationId", "organization_id") == Some(organization_id)
                && accounting_row_id(row, "companyId", "company_id") == Some(company_id)
                && row_not_soft_deleted(row)
        })
        .filter_map(|row| accounting_row_id(row, "id", "id"))
        .collect()
}

fn accounting_row_id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    let value = row.get(camel).or_else(|| row.get(snake))?;
    if let Some(object) = value.as_object() {
        // Reject ambiguous/malformed option encodings rather than taking the
        // first value from a multi-value Some or ignoring extra variant keys.
        if object.len() != 1 {
            return None;
        }
        if let Some(inner) = object.get("some").or_else(|| object.get("Some")) {
            if inner.as_array().is_some_and(|items| items.len() != 1) {
                return None;
            }
        }
    }
    row_u64(row, camel, snake)
        .ok()
        .flatten()
        .filter(|id| *id > 0)
}

fn filter_accounting_child_rows(
    scope: AccountingChildScope,
    organization_id: u64,
    parent_ids: &HashSet<u64>,
    rows: &mut Vec<Value>,
) {
    rows.retain(|row| {
        accounting_row_id(row, "organizationId", "organization_id") == Some(organization_id)
            && accounting_row_id(row, scope.parent_camel, scope.parent_column)
                .is_some_and(|id| parent_ids.contains(&id))
    });
}

fn require_accounting_child_read(
    resource: &str,
    fa: Option<&FieldAccessContext>,
) -> Result<(), ApiError> {
    let allowed = has_resource_read_permission(fa, resource)
        || accounting_read_permission_resource(resource)
            .is_some_and(|parent| has_resource_read_permission(fa, parent));
    if !allowed {
        return Err(ApiError::Forbidden(format!(
            "Read permission denied for Accounting resource '{resource}'"
        )));
    }
    Ok(())
}

/// Read only children of parents owned by the membership-resolved company.
///
/// The dispatcher must resolve `accounting_company_id` with the existing
/// `resolve_accounting_company_id`, including `accounting_child_resource` in
/// that decision. It must gate the canonical read grant before an owner-token
/// read; this helper repeats the child/parent grant check defensively. Parent
/// queries select only scope keys, while child projection uses the child policy.
/// Unassigned/deleted tax deadlines and absent or malformed parent links are
/// excluded, matching the existing selected-company tax-deadline read policy.
pub(super) async fn read_accounting_child_rows(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
    accounting_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let scope = AccountingChildScope::for_resource(resource)?;
    require_accounting_child_read(resource, fa)?;
    let company_id = accounting_company_id
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::Internal("accounting child company scope not resolved".into()))?;
    if organization_id == 0 || fa.is_some_and(|access| access.organization_id != organization_id) {
        return Err(ApiError::Forbidden(
            "Accounting organization scope mismatch".into(),
        ));
    }
    let parents = client
        .query_sql(&scope.parent_sql(organization_id, company_id))
        .await
        .map_err(ApiError::internal)?;
    let parent_ids = accounting_parent_ids(&parents, organization_id, company_id);
    if parent_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut columns = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
    // Authorization must not depend on the caller's field projection containing
    // the foreign key. Fetch it internally and strip it if not requested.
    let internal_parent_column = !columns.iter().any(|column| column == scope.parent_column);
    if internal_parent_column {
        columns.push(scope.parent_column.to_owned());
    }
    let mut rows = client
        .query_sql(&scope.child_sql(organization_id, &columns, &parent_ids))
        .await
        .map_err(ApiError::internal)?;
    filter_accounting_child_rows(scope, organization_id, &parent_ids, &mut rows);
    if internal_parent_column {
        for row in &mut rows {
            if let Some(object) = row.as_object_mut() {
                object.remove(scope.parent_column);
                object.remove(scope.parent_camel);
            }
        }
    }
    Ok(rows)
}

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

#[cfg(test)]
mod tests {
    use super::super::execute_resource_query_for_company;
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    fn field_access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_id: 7,
            role_name: "accountant".into(),
            is_superuser: false,
            role_permissions: permissions
                .iter()
                .map(|permission| (*permission).into())
                .collect(),
            identity_hex: "01".repeat(32),
            field_permissions: Vec::new(),
        }
    }

    struct HttpFixture {
        client: StdbClient,
        queries: Arc<Mutex<Vec<String>>>,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for HttpFixture {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    // Return only SELECTed columns through the real SATS HTTP decoding path.
    // Hostile rows deliberately bypass WHERE evaluation to exercise post-filters.
    async fn http_fixture(replies: Vec<(&'static str, Vec<Value>)>) -> HttpFixture {
        use axum::{routing::post, Json, Router};
        let queries = Arc::new(Mutex::new(Vec::new()));
        let recorded = queries.clone();
        let pending = Arc::new(Mutex::new(VecDeque::from(replies)));
        let app = Router::new().route(
            "/v1/database/accounting/sql",
            post(move |sql: String| {
                let recorded = recorded.clone();
                let pending = pending.clone();
                async move {
                    recorded.lock().unwrap().push(sql.clone());
                    let (table, rows) =
                        pending.lock().unwrap().pop_front().expect("unexpected SQL");
                    assert!(sql.contains(&format!(" FROM {table} WHERE ")), "{sql}");
                    assert!(sql.contains("organization_id = 42"), "{sql}");
                    assert!(!sql.contains("SELECT *") && !sql.contains(" IN "), "{sql}");
                    let columns: Vec<_> = sql
                        .strip_prefix("SELECT ")
                        .unwrap()
                        .split_once(" FROM ")
                        .unwrap()
                        .0
                        .split(", ")
                        .collect();
                    Json(json!([{
                        "schema": {"elements": columns.iter().map(|column| json!({
                            "name": {"some": column}
                        })).collect::<Vec<_>>()},
                        "rows": rows.iter().map(|row| columns.iter().map(|column|
                            row.get(*column).cloned().unwrap_or(Value::Null)
                        ).collect::<Vec<_>>()).collect::<Vec<_>>()
                    }]))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        HttpFixture {
            client: StdbClient::new(
                format!("http://{address}"),
                "accounting".into(),
                "fixture-token".into(),
            ),
            queries,
            task,
        }
    }

    fn membership_reply() -> (&'static str, Vec<Value>) {
        // HTTP Some wraps a scalar, not an array, before StdbClient decoding.
        (
            "user_organization",
            vec![json!({
                "id": 7, "organization_id": 42, "company_id": {"some": 198}, "is_active": true
            })],
        )
    }

    fn assert_membership_query(sql: &str, access: &FieldAccessContext) {
        assert_eq!(sql, format!(
            "SELECT id, organization_id, company_id, is_active FROM user_organization WHERE organization_id = 42 AND user_identity = 0x{} AND is_active = true",
            access.identity_hex
        ));
    }

    #[tokio::test]
    async fn dispatcher_http_profit_loss_uses_membership_company_and_report_projection() {
        let access = field_access(&["financial_report:read"]);
        let fixture = http_fixture(vec![
            membership_reply(),
            (
                "profit_loss_line",
                vec![
                    json!({"id": 501, "organization_id": 42, "company_id": 198,
                    "report_id": 811, "sequence": 3, "name": "Distinctive operating income",
                    "amount": 98.25, "comparison_amount": 61.5}),
                    json!({"id": 502, "organization_id": 42, "company_id": 199, "report_id": 812}),
                ],
            ),
        ])
        .await;
        let rows = execute_resource_query_for_company(
            &fixture.client,
            "profit-loss-lines",
            42,
            &access.identity_hex,
            Some(&access),
            None,
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], 501);
        assert_eq!(rows[0]["companyId"], 198);
        assert_eq!(rows[0]["reportId"], 811);
        assert_eq!(rows[0]["sequence"], 3);
        assert_eq!(rows[0]["amount"], 98.25);
        assert_eq!(rows[0]["comparisonAmount"], 61.5);
        assert_eq!(rows[0]["name"], "Distinctive operating income");
        let queries = fixture.queries.lock().unwrap();
        assert_eq!(queries.len(), 2);
        assert_membership_query(&queries[0], &access);
        let columns = resolve_http_sql_columns("profit-loss-lines", Some(&access)).unwrap();
        assert!(queries[1].starts_with(&format!(
            "SELECT {} FROM profit_loss_line ",
            columns.join(", ")
        )));
        assert!(queries[1].contains("organization_id = 42 AND company_id = 198"));
        assert!(queries[1].contains("report_id"));
    }

    #[tokio::test]
    async fn dispatcher_http_children_preserve_links_and_exclude_hostile_parent_scope() {
        for (resource, grant, parent_table, child_table, relation, camel) in [
            (
                "bank-statement-import-lines",
                "account_bank_statement:read",
                "bank_statement_import",
                "bank_statement_import_line",
                "import_id",
                "importId",
            ),
            (
                "tax-deadline-reminders",
                "tax_deadline:read",
                "tax_deadline",
                "tax_deadline_reminder",
                "tax_deadline_id",
                "taxDeadlineId",
            ),
        ] {
            let reminder = resource == "tax-deadline-reminders";
            let access = field_access(&[grant]);
            let mut parents = vec![
                json!({"id": 11, "organization_id": 42, "company_id": 198}),
                json!({"id": 12, "organization_id": 42, "company_id": 199}),
                json!({"id": 13, "organization_id": 43, "company_id": 198}),
                json!({"id": 14, "organization_id": 42, "company_id": "bad"}),
            ];
            if reminder {
                for parent in &mut parents {
                    parent["company_id"] = json!({"some": parent["company_id"].clone()});
                    parent["deleted_at"] = json!({"none": []});
                }
                parents.push(json!({"id": 15, "organization_id": 42, "company_id": {"none": []}, "deleted_at": {"none": []}}));
                parents.push(json!({"id": 16, "organization_id": 42, "company_id": {"some": 198}, "deleted_at": {"some": 123}}));
            }
            let mut children: Vec<_> = [
                (101, 42, json!(11)),
                (102, 42, json!(12)),
                (103, 42, json!(13)),
                (104, 43, json!(11)),
                (105, 42, json!(999)),
                (106, 42, json!(14)),
                (107, 42, Value::Null),
                (108, 42, json!("bad")),
                (109, 42, json!(15)),
                (110, 42, json!(16)),
            ]
            .into_iter()
            .map(|(id, org, parent)| {
                let parent = if reminder && !parent.is_null() {
                    json!({"some": parent})
                } else {
                    parent
                };
                json!({"id": id, "organization_id": org, (relation): parent})
            })
            .collect();
            if reminder {
                children[0]["status"] = json!("pending");
                children[0]["days_before_deadline"] = json!(9);
            } else {
                children[0]["row_number"] = json!(4);
                children[0]["amount"] = json!({"some": 77.5});
                children[0]["reference"] = json!({"some": "BANK-ROW-4"});
            }
            let fixture = http_fixture(vec![
                membership_reply(),
                (parent_table, parents),
                (child_table, children),
            ])
            .await;
            let rows = execute_resource_query_for_company(
                &fixture.client,
                resource,
                42,
                &access.identity_hex,
                Some(&access),
                Some(198),
            )
            .await
            .unwrap();
            assert_eq!(rows.len(), 1, "{resource}: {rows:?}");
            assert_eq!(rows[0]["id"], 101);
            assert_eq!(rows[0]["organizationId"], 42);
            assert_eq!(rows[0][camel], 11);
            assert!(
                rows[0].get("companyId").is_none(),
                "no child company column"
            );
            if reminder {
                assert_eq!(rows[0]["status"], "pending");
                assert_eq!(rows[0]["daysBeforeDeadline"], 9);
            } else {
                assert_eq!(rows[0]["rowNumber"], 4);
                assert_eq!(rows[0]["amount"], 77.5);
                assert_eq!(rows[0]["reference"], "BANK-ROW-4");
            }
            let queries = fixture.queries.lock().unwrap();
            assert_eq!(queries.len(), 3);
            assert_membership_query(&queries[0], &access);
            let columns = resolve_http_sql_columns(resource, Some(&access)).unwrap();
            assert!(queries[2].starts_with(&format!(
                "SELECT {} FROM {child_table} ",
                columns.join(", ")
            )));
            assert!(!queries[2].contains("company_id"));
            if reminder {
                assert_eq!(queries[1], "SELECT id, organization_id, company_id, deleted_at FROM tax_deadline WHERE organization_id = 42");
                assert!(!queries[2].contains("tax_deadline_id ="));
            } else {
                assert!(queries[1].ends_with("WHERE organization_id = 42 AND company_id = 198"));
                assert!(queries[2].ends_with("WHERE organization_id = 42 AND (import_id = 11)"));
            }
        }
    }

    #[tokio::test]
    async fn dispatcher_http_forged_company_is_rejected_after_membership_before_data_queries() {
        for (resource, grant) in [
            ("profit-loss-lines", "financial_report:read"),
            ("bank-statement-import-lines", "account_bank_statement:read"),
            ("tax-deadline-reminders", "tax_deadline:read"),
        ] {
            let access = field_access(&[grant]);
            let fixture = http_fixture(vec![membership_reply()]).await;
            let result = execute_resource_query_for_company(
                &fixture.client,
                resource,
                42,
                &access.identity_hex,
                Some(&access),
                Some(199),
            )
            .await;
            assert!(
                matches!(result, Err(ApiError::Forbidden(message)) if message == "Cannot query another company's accounting data")
            );
            let queries = fixture.queries.lock().unwrap();
            assert_eq!(queries.len(), 1, "{resource}");
            assert_membership_query(&queries[0], &access);
        }
    }

    #[tokio::test]
    async fn dispatcher_http_denied_read_grant_issues_no_queries() {
        for resource in [
            "profit-loss-lines",
            "bank-statement-import-lines",
            "tax-deadline-reminders",
        ] {
            let access = field_access(&[
                "financial_report:write",
                "account_bank_statement:write",
                "tax_deadline:write",
            ]);
            let fixture = http_fixture(vec![]).await;
            let result = execute_resource_query_for_company(
                &fixture.client,
                resource,
                42,
                &access.identity_hex,
                Some(&access),
                Some(198),
            )
            .await;
            assert!(matches!(result, Err(ApiError::Forbidden(_))), "{resource}");
            assert!(fixture.queries.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn accounting_child_parent_validation_is_company_and_org_scoped() {
        let parents = vec![
            json!({"id": 11, "organization_id": 42, "company_id": 198}),
            json!({"id": "12", "organizationId": "42", "companyId": {"some": ["198"]}}),
            json!({"id": 13, "organization_id": 42, "company_id": 199}),
            json!({"id": 14, "organization_id": 43, "company_id": 198}),
            json!({"id": 15, "organization_id": 42, "company_id": null}),
            json!({"id": 16, "organization_id": 42, "company_id": {"none": []}}),
            json!({"id": 17, "organization_id": 42}),
            json!({"id": 18, "company_id": 198}),
            json!({"id": 19, "organization_id": 42, "company_id": "bad"}),
            json!({"id": 20, "organization_id": "bad", "company_id": 198}),
            json!({"id": 21, "organization_id": 42, "company_id": 198, "deleted_at": 123}),
            json!({"id": 22, "organizationId": 42, "companyId": 198, "deletedAt": {"some": [123]}}),
            json!({"id": 23, "organization_id": 42, "company_id": {"some": [198, 199]}}),
            json!({"id": 24, "organization_id": 42, "company_id": {"some": [198], "none": []}}),
            json!({"id": 0, "organization_id": 42, "company_id": 198}),
            json!({"id": "bad", "organization_id": 42, "company_id": 198}),
            json!({"organization_id": 42, "company_id": 198}),
        ];
        assert_eq!(
            accounting_parent_ids(&parents, 42, 198),
            HashSet::from([11, 12])
        );
        assert_eq!(
            accounting_parent_ids(&parents, 42, 199),
            HashSet::from([13])
        );
        assert!(accounting_parent_ids(&parents, 44, 198).is_empty());
    }

    #[test]
    fn accounting_children_reject_cross_company_org_and_missing_parents() {
        for resource in ["bank-statement-import-lines", "tax-deadline-reminders"] {
            let scope = AccountingChildScope::for_resource(resource).unwrap();
            let parents = vec![
                json!({"id": 11, "organization_id": 42, "company_id": 198}),
                json!({"id": 12, "organization_id": 42, "company_id": 199}),
                json!({"id": 13, "organization_id": 43, "company_id": 198}),
            ];
            let parent_ids = accounting_parent_ids(&parents, 42, 198);
            let mut rows = vec![
                json!({"id": 1, "organization_id": 42, (scope.parent_column): 11}),
                json!({"id": 2, "organizationId": "42", (scope.parent_camel): "11"}),
                json!({"id": 3, "organization_id": 42, (scope.parent_column): 12}),
                json!({"id": 4, "organization_id": 42, (scope.parent_column): 13}),
                json!({"id": 5, "organization_id": 43, (scope.parent_column): 11}),
                json!({"id": 6, "organization_id": 42, (scope.parent_column): 999}),
                json!({"id": 7, "organization_id": 42}),
                json!({"id": 8, "organization_id": 42, (scope.parent_column): null}),
                json!({"id": 9, "organization_id": 42, (scope.parent_column): "bad"}),
                json!({"id": 10, "organization_id": 42, (scope.parent_column): 0}),
                json!({"id": 11, (scope.parent_column): 11}),
                json!({"id": 12, "organization_id": "bad", (scope.parent_column): 11}),
            ];
            filter_accounting_child_rows(scope, 42, &parent_ids, &mut rows);
            assert_eq!(
                rows.iter()
                    .map(|row| row["id"].as_u64().unwrap())
                    .collect::<Vec<_>>(),
                vec![1, 2],
                "{resource}"
            );
            filter_accounting_child_rows(scope, 42, &HashSet::new(), &mut rows);
            assert!(rows.is_empty(), "{resource}");
        }
    }

    #[test]
    fn accounting_reminders_decode_optional_links_without_accepting_malformed_variants() {
        let scope = AccountingChildScope::for_resource("tax-deadline-reminders").unwrap();
        let mut rows = vec![
            json!({"id": 1, "organization_id": 42, "tax_deadline_id": {"some": ["11"]}}),
            json!({"id": 2, "organizationId": 42, "taxDeadlineId": {"Some": 11}}),
            json!({"id": 3, "organization_id": 42, "tax_deadline_id": {"none": []}}),
            json!({"id": 4, "organization_id": 42, "tax_deadline_id": {"some": []}}),
            json!({"id": 5, "organization_id": 42, "tax_deadline_id": {"some": ["bad"]}}),
            json!({"id": 6, "organization_id": 42, "tax_deadline_id": {"some": [11, 12]}}),
            json!({"id": 7, "organization_id": 42, "tax_deadline_id": {"some": [11], "none": []}}),
        ];
        filter_accounting_child_rows(scope, 42, &HashSet::from([11]), &mut rows);
        assert_eq!(
            rows.iter()
                .map(|row| row["id"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn accounting_child_sql_uses_real_parents_and_never_fabricates_child_company_columns() {
        let imports = AccountingChildScope::for_resource("bank-statement-import-lines").unwrap();
        assert_eq!(
            imports.parent_sql(42, 198),
            "SELECT id, organization_id, company_id FROM bank_statement_import WHERE organization_id = 42 AND company_id = 198"
        );
        let columns = vec!["id".into(), "organization_id".into(), "import_id".into()];
        assert_eq!(
            imports.child_sql(42, &columns, &HashSet::from([12, 11])),
            "SELECT id, organization_id, import_id FROM bank_statement_import_line WHERE organization_id = 42 AND (import_id = 11 OR import_id = 12)"
        );
        let reminders = AccountingChildScope::for_resource("tax-deadline-reminders").unwrap();
        assert_eq!(
            reminders.parent_sql(42, 198),
            "SELECT id, organization_id, company_id, deleted_at FROM tax_deadline WHERE organization_id = 42"
        );
        let columns = vec![
            "id".into(),
            "organization_id".into(),
            "tax_deadline_id".into(),
        ];
        let sql = reminders.child_sql(42, &columns, &HashSet::from([11]));
        assert_eq!(sql, "SELECT id, organization_id, tax_deadline_id FROM tax_deadline_reminder WHERE organization_id = 42");
        assert!(!sql.contains("company_id"));
        assert!(
            !sql.contains("tax_deadline_id ="),
            "Option<u64> cannot be compared to scalar"
        );
        for resource in [
            "profit-loss-lines",
            "balance-sheet-lines",
            "cash-flow-lines",
            "consolidation-company-rates",
            "bank-statement-import-lines-extra",
        ] {
            assert!(
                AccountingChildScope::for_resource(resource).is_err(),
                "{resource}"
            );
        }
    }

    #[test]
    fn pass12_direct_resources_keep_company_and_org_sql_predicates() {
        for resource in [
            "profit-loss-lines",
            "balance-sheet-lines",
            "cash-flow-lines",
            "consolidation-company-rates",
        ] {
            let registry = registry_get(resource).unwrap();
            let sql = super::super::registered::select_registered_sql(
                resource,
                &registry.table,
                42,
                None,
                None,
                None,
                Some(198),
                None,
            )
            .unwrap();
            assert!(sql.contains("organization_id = 42"), "{resource}: {sql}");
            assert!(sql.contains("company_id = 198"), "{resource}: {sql}");
            assert!(!sql.contains(":company_id"), "{resource}: {sql}");
        }
    }

    #[tokio::test]
    async fn accounting_child_reads_reject_unresolved_scope_before_querying() {
        // An invalid URL makes any accidental upstream query fail distinctly.
        let client = StdbClient::new("invalid-url".into(), "test".into(), String::new());
        let access = field_access(&["account_bank_statement:read"]);
        for company_id in [None, Some(0)] {
            assert!(matches!(
                read_accounting_child_rows(
                    &client, "bank-statement-import-lines", 42, Some(&access), company_id,
                ).await,
                Err(ApiError::Internal(message)) if message == "accounting child company scope not resolved"
            ));
        }
        for organization_id in [0, 43] {
            assert!(matches!(
                read_accounting_child_rows(
                    &client, "bank-statement-import-lines", organization_id, Some(&access), Some(198),
                ).await,
                Err(ApiError::Forbidden(message)) if message == "Accounting organization scope mismatch"
            ));
        }
        assert!(matches!(
            read_accounting_child_rows(
                &client, "bank-statement-import-lines", 42, None, Some(198),
            ).await,
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn accounting_child_reads_require_independent_or_canonical_parent_read_grant() {
        for (resource, parent_grant, child_grant) in [
            (
                "bank-statement-import-lines",
                "account_bank_statement:read",
                "bank_statement_import_line:read",
            ),
            (
                "tax-deadline-reminders",
                "tax_deadline:read",
                "tax_deadline_reminder:read",
            ),
        ] {
            for grant in [parent_grant, child_grant, "*:*"] {
                assert!(
                    require_accounting_child_read(resource, Some(&field_access(&[grant]))).is_ok(),
                    "{resource}: {grant}"
                );
            }
            for grants in [
                vec![],
                vec!["contacts:read"],
                vec!["account_bank_statement:write"],
                vec!["tax_deadline:write"],
            ] {
                assert!(
                    matches!(
                        require_accounting_child_read(resource, Some(&field_access(&grants))),
                        Err(ApiError::Forbidden(_))
                    ),
                    "{resource}: {grants:?}"
                );
            }
            assert!(matches!(
                require_accounting_child_read(resource, None),
                Err(ApiError::Forbidden(_))
            ));
        }
    }
}
