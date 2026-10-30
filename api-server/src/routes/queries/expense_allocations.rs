//! Exact-parent allocation reads. An empty vector means a verified expense has no allocations.

use crate::error::ApiError;
use crate::query_exec::resolve_membership_company_id;
use crate::trusted_context::TrustedOperationContext;
use serde_json::Value;
use stdb_auth::{
    has_resource_read_permission, select_org_and_company_scoped_sql, FieldAccessContext,
};

const ALLOCATION_LIMIT: usize = 1_000;

fn require_read(access: &FieldAccessContext, organization_id: u64) -> Result<(), ApiError> {
    if access.organization_id != organization_id
        || !has_resource_read_permission(Some(access), "expenses")
        || !has_resource_read_permission(Some(access), "expense-allocations")
    {
        return Err(ApiError::Forbidden(
            "Expense allocation read access is required".into(),
        ));
    }
    Ok(())
}

fn scoped_sql(
    resource: &str,
    table: &str,
    organization_id: u64,
    company_id: u64,
    expense_id: u64,
    access: &FieldAccessContext,
) -> Result<String, ApiError> {
    require_read(access, organization_id)?;
    if company_id == 0 || expense_id == 0 {
        return Err(ApiError::BadRequest(
            "A positive companyId and expenseId are required".into(),
        ));
    }
    let parent_column = if resource == "expenses" {
        "id"
    } else {
        "expense_id"
    };
    select_org_and_company_scoped_sql(
        resource,
        table,
        organization_id,
        company_id,
        Some(access),
        &format!(" AND {parent_column} = {expense_id}"),
        &format!(" LIMIT {}", ALLOCATION_LIMIT + 1),
    )
    .map_err(ApiError::Internal)
}

pub(super) async fn read(
    context: &TrustedOperationContext,
    requested_company_id: Option<u64>,
    expense_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let org = context.organization_id();
    require_read(context.field_access(), org)?;
    let requested_company = requested_company_id.filter(|id| *id > 0).ok_or_else(|| {
        ApiError::BadRequest("companyId is required for expense allocations".into())
    })?;
    let expense = expense_id.filter(|id| *id > 0).ok_or_else(|| {
        ApiError::BadRequest("expenseId is required for expense allocations".into())
    })?;
    let company = resolve_membership_company_id(
        context.client(),
        org,
        context.actor_identity(),
        Some(requested_company),
        "Cannot read expense allocations in another company",
    )
    .await?;
    let parent_sql = scoped_sql(
        "expenses",
        "hr_expense",
        org,
        company,
        expense,
        context.field_access(),
    )?;
    let parent = context
        .client()
        .query_sql(&parent_sql)
        .await
        .map_err(ApiError::internal)?;
    if parent.len() != 1 {
        return Err(ApiError::NotFound(
            "Expense not found in this company".into(),
        ));
    }
    let sql = scoped_sql(
        "expense-allocations",
        "hr_expense_allocation",
        org,
        company,
        expense,
        context.field_access(),
    )?;
    let rows = context
        .client()
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    if rows.len() > ALLOCATION_LIMIT {
        return Err(ApiError::Unavailable(
            "Expense allocations exceed the supported review size".into(),
        ));
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn access() -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_id: 1,
            role_permissions: vec!["hr_expense:read".into()],
            ..FieldAccessContext::default()
        }
    }

    #[test]
    fn parent_and_children_require_current_expense_read_permission() {
        let mut actor = access();
        assert!(require_read(&actor, 42).is_ok());
        assert!(require_read(&actor, 43).is_err());
        actor.role_permissions = vec!["hr_expense:write".into()];
        assert!(require_read(&actor, 42).is_err());
        actor.role_permissions.clear();
        assert!(require_read(&actor, 42).is_err());
    }

    #[test]
    fn parent_and_child_queries_are_exact_and_bounded() {
        for (resource, table, column) in [
            ("expenses", "hr_expense", "id"),
            ("expense-allocations", "hr_expense_allocation", "expense_id"),
        ] {
            let sql = scoped_sql(resource, table, 42, 7, 9007199254740993, &access()).unwrap();
            assert!(!sql.contains("SELECT *"));
            assert!(sql.contains(&format!("FROM {table} WHERE organization_id = 42 AND company_id = 7 AND {column} = 9007199254740993")), "{sql}");
            assert!(sql.ends_with("LIMIT 1001"));
            assert!(scoped_sql(resource, table, 42, 0, 1, &access()).is_err());
            assert!(scoped_sql(resource, table, 42, 7, 0, &access()).is_err());
        }
    }

    #[test]
    fn child_projection_respects_explicit_field_masks() {
        let mut actor = access();
        actor.field_permissions.push(
            serde_json::from_value(json!({
                "organizationId":42,"roleId":1,"resource":"expense-allocations",
                "action":"read","allowedFields":["billable"]
            }))
            .unwrap(),
        );
        let sql = scoped_sql(
            "expense-allocations",
            "hr_expense_allocation",
            42,
            7,
            9,
            &actor,
        )
        .unwrap();
        assert!(sql.contains("billable"));
        for field in [
            "analytic_account_id",
            "project_id",
            "share_percent",
            "amount",
            "metadata",
        ] {
            assert!(!sql.contains(field), "field mask exposed {field}: {sql}");
        }
        assert!(sql.contains("organization_id = 42 AND company_id = 7 AND expense_id = 9"));
    }

    struct Fixture {
        context: TrustedOperationContext,
        queries: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn fixture(parent_exists: bool, allocations: Vec<Value>) -> Fixture {
        use axum::{http::HeaderMap, routing::post, Json, Router};
        use std::sync::{Arc, Mutex};
        let queries = Arc::new(Mutex::new(Vec::new()));
        let recorded = queries.clone();
        let router = Router::new().route("/v1/database/expenses/sql", post(move |headers: HeaderMap, sql: String| {
            let recorded = recorded.clone();
            let allocations = allocations.clone();
            async move {
                assert_eq!(headers.get("authorization").unwrap(), "Bearer actor-token");
                recorded.lock().unwrap().push(sql.clone());
                assert!(sql.contains("organization_id = 42"), "{sql}");
                let rows = if sql.contains(" FROM user_organization ") {
                    vec![json!({"id":1,"organization_id":42,"company_id":7,"is_active":true,"role_id":1})]
                } else if sql.contains(" FROM user_role_assignment ") { vec![]
                } else if sql.contains(" FROM role ") {
                    vec![json!({"id":1,"name":"Clerk","permissions":["hr_expense:read"],"is_active":true})]
                } else if sql.contains(" FROM hr_expense_allocation ") {
                    assert!(sql.contains("company_id = 7 AND expense_id = 9"));
                    allocations
                } else if sql.contains(" FROM hr_expense ") {
                    assert!(sql.contains("company_id = 7 AND id = 9"));
                    if parent_exists { vec![json!({"id":9,"organization_id":42,"company_id":7})] } else { vec![] }
                } else { panic!("Unexpected SQL: {sql}") };
                let columns: Vec<_> = sql.strip_prefix("SELECT ").unwrap().split_once(" FROM ").unwrap().0.split(", ").collect();
                Json(json!([{"schema":{"elements":columns.iter().map(|column|json!({"name":{"some":column}})).collect::<Vec<_>>()},
                    "rows":rows.iter().map(|row|columns.iter().map(|column|row.get(*column).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>()).collect::<Vec<_>>() }]))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let mut actor = access();
        actor.identity_hex = "ab".repeat(32);
        let context = TrustedOperationContext::from_session(
            &crate::session::ApiSession {
                stdb_token: "actor-token".into(),
                identity_hex: actor.identity_hex.clone(),
                organization_id: Some(42),
                field_access: Some(actor),
            },
            stdb_client::StdbClient::new(
                format!("http://{address}"),
                "expenses".into(),
                "actor-token".into(),
            ),
            crate::trusted_context::RESOURCE_QUERY_OPERATION_ID,
        )
        .unwrap();
        Fixture {
            context,
            queries,
            task,
        }
    }

    #[tokio::test]
    async fn http_read_verifies_membership_and_parent_before_returning_saved_rows() {
        let fixture = fixture(true, vec![json!({"id":9007199254740993u64,"organization_id":42,"company_id":7,"expense_id":9,
            "project_id":null,"analytic_account_id":8,"share_percent":100.0,"amount":12.34567,"billable":false,"metadata":"saved"})]).await;
        let rows = read(&fixture.context, Some(7), Some(9)).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], 9007199254740993u64);
        assert_eq!(rows[0]["expenseId"], 9);
        assert_eq!(rows[0]["amount"], 12.34567);
        assert_eq!(rows[0]["metadata"], "saved");
        let queries = fixture.queries.lock().unwrap();
        let parent = queries
            .iter()
            .position(|q| q.contains(" FROM hr_expense "))
            .unwrap();
        let child = queries
            .iter()
            .position(|q| q.contains(" FROM hr_expense_allocation "))
            .unwrap();
        assert!(parent < child);
    }

    #[tokio::test]
    async fn unavailable_parent_or_foreign_company_never_reads_children() {
        let missing = fixture(false, vec![]).await;
        assert!(matches!(
            read(&missing.context, Some(7), Some(9)).await,
            Err(ApiError::NotFound(_))
        ));
        assert!(!missing
            .queries
            .lock()
            .unwrap()
            .iter()
            .any(|q| q.contains(" FROM hr_expense_allocation ")));
        let foreign = fixture(true, vec![]).await;
        assert!(matches!(
            read(&foreign.context, Some(8), Some(9)).await,
            Err(ApiError::Forbidden(_))
        ));
        assert!(
            !foreign
                .queries
                .lock()
                .unwrap()
                .iter()
                .any(|q| q.contains(" FROM hr_expense ")
                    || q.contains(" FROM hr_expense_allocation "))
        );
    }

    #[tokio::test]
    async fn allocation_overflow_is_unavailable_instead_of_a_partial_replacement() {
        let fixture = fixture(
            true,
            vec![
                json!({"id":1,"organization_id":42,"company_id":7,"expense_id":9});
                ALLOCATION_LIMIT + 1
            ],
        )
        .await;
        assert!(matches!(
            read(&fixture.context, Some(7), Some(9)).await,
            Err(ApiError::Unavailable(_))
        ));
    }
}
