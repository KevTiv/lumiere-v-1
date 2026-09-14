//! Bounded, authorized acquisition for the first presentation read capability.

use crate::{
    error::ApiError, query_exec::resolve_accounting_company_id,
    trusted_context::TrustedOperationContext,
};
use serde::Serialize;
use serde_json::Value;
use stdb_auth::{has_resource_read_permission, registry_get, resolve_http_sql_columns};

const RESOURCE: &str = "account-moves";
const MAX_LIMIT: u32 = 100;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountMovesPage {
    pub rows: Vec<Value>,
    pub truncated: bool,
}

/// Acquire one bounded account-moves page from a company-scoped trusted context.
///
/// Organization and company authorization are resolved from the trusted
/// context and are always present in the SQL. The result is a bounded preview;
/// it does not claim stable global pagination order.
pub(crate) async fn acquire_account_moves(
    context: &TrustedOperationContext,
    company_id: u64,
    limit: u32,
) -> Result<AccountMovesPage, ApiError> {
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Unprocessable(
            "limit must be between 1 and 100".into(),
        ));
    }
    if !has_resource_read_permission(Some(context.field_access()), RESOURCE) {
        return Err(ApiError::Forbidden(
            "Read permission denied for resource 'account-moves'".into(),
        ));
    }
    let resolved_company_id = resolve_accounting_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        Some(company_id),
    )
    .await?;
    let registry = registry_get(RESOURCE)
        .ok_or_else(|| ApiError::Internal("account-moves registry entry is missing".into()))?;
    let columns = resolve_http_sql_columns(RESOURCE, Some(context.field_access()))
        .map_err(ApiError::Internal)?
        .join(", ");
    let sql = build_account_moves_sql(
        &columns,
        &registry.table,
        context.organization_id(),
        resolved_company_id,
        limit,
    );
    let rows = context
        .client()
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    page_from_rows(rows, context.organization_id(), resolved_company_id, limit)
}

fn build_account_moves_sql(
    columns: &str,
    table: &str,
    organization_id: u64,
    company_id: u64,
    limit: u32,
) -> String {
    format!("SELECT {columns} FROM {table} WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT {}", limit + 1)
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    row.get(key).and_then(Value::as_u64).or_else(|| {
        row.get(key)
            .and_then(Value::as_str)
            .and_then(|value| value.parse().ok())
    })
}

fn row_in_scope(row: &Value, organization_id: u64, company_id: u64) -> bool {
    row_u64(row, "organizationId") == Some(organization_id)
        && row_u64(row, "companyId") == Some(company_id)
}

fn page_from_rows(
    mut rows: Vec<Value>,
    organization_id: u64,
    company_id: u64,
    limit: u32,
) -> Result<AccountMovesPage, ApiError> {
    if rows.len() > limit as usize + 1 {
        return Err(ApiError::Internal(
            "account-moves query exceeded its bound".into(),
        ));
    }
    let mut ids = std::collections::HashSet::with_capacity(rows.len());
    for row in &rows {
        if !row_in_scope(row, organization_id, company_id) {
            return Err(ApiError::Internal(
                "account-moves query returned an out-of-scope row".into(),
            ));
        }
        let id = row_u64(row, "id")
            .ok_or_else(|| ApiError::Internal("account-moves row is missing id".into()))?;
        if id == 0 || !ids.insert(id) {
            return Err(ApiError::Internal(
                "account-moves query returned a missing or duplicate id".into(),
            ));
        }
    }
    rows.sort_by_key(|row| row_u64(row, "id").unwrap_or_default());
    let truncated = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    Ok(AccountMovesPage { rows, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn sats_response(fields: &[&str], rows: &[Vec<u64>]) -> String {
        let elements: Vec<Value> = fields
            .iter()
            .map(|field| {
                json!({
                    "name": {"some": field}, "algebraic_type": {"U64": []}
                })
            })
            .collect();
        json!([{"schema": {"elements": elements}, "rows": rows}]).to_string()
    }

    async fn mock_stdb(
        responses: Vec<String>,
    ) -> (
        String,
        Arc<AtomicUsize>,
        Arc<Mutex<Vec<String>>>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let queries = Arc::new(Mutex::new(Vec::new()));
        let count_for_task = Arc::clone(&count);
        let queries_for_task = Arc::clone(&queries);
        let task = tokio::spawn(async move {
            for response in responses {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut request = Vec::new();
                let mut chunk = [0_u8; 4096];
                let body_start;
                loop {
                    let Ok(read) = stream.read(&mut chunk).await else {
                        return;
                    };
                    if read == 0 {
                        return;
                    }
                    request.extend_from_slice(&chunk[..read]);
                    if let Some(position) =
                        request.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        body_start = position + 4;
                        let headers = String::from_utf8_lossy(&request[..position]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.strip_prefix("content-length:")
                                    .or_else(|| line.strip_prefix("Content-Length:"))
                                    .and_then(|value| value.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        while request.len() < body_start + length {
                            let Ok(more) = stream.read(&mut chunk).await else {
                                return;
                            };
                            if more == 0 {
                                return;
                            }
                            request.extend_from_slice(&chunk[..more]);
                        }
                        break;
                    }
                }
                let sql = String::from_utf8_lossy(&request[body_start..]).to_string();
                queries_for_task.lock().unwrap().push(sql.clone());
                count_for_task.fetch_add(1, Ordering::SeqCst);
                let body = response;
                let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                if stream.write_all(reply.as_bytes()).await.is_err() {
                    return;
                }
            }
        });
        (format!("http://{address}"), count, queries, task)
    }

    fn trusted_context(base_url: &str) -> TrustedOperationContext {
        let token = "presentation-test-token";
        let session = crate::session::ApiSession {
            stdb_token: token.into(),
            identity_hex: "ab".repeat(32),
            organization_id: Some(7),
            field_access: Some(stdb_auth::FieldAccessContext {
                organization_id: 7,
                role_id: 1,
                role_name: "reader".into(),
                is_superuser: false,
                role_permissions: vec!["account-moves:read".into()],
                identity_hex: "ab".repeat(32),
                field_permissions: vec![],
            }),
        };
        let client =
            stdb_client::StdbClient::new(base_url.into(), "lumiere-test".into(), token.into());
        TrustedOperationContext::from_session(
            &session,
            client,
            crate::trusted_context::RESOURCE_QUERY_OPERATION_ID,
        )
        .unwrap()
    }

    #[test]
    fn validates_limit() {
        assert!(!(1..=MAX_LIMIT).contains(&0));
        assert!((1..=MAX_LIMIT).contains(&100));
        assert!(!(1..=MAX_LIMIT).contains(&101));
    }

    #[test]
    fn row_scope_requires_both_authoritative_fields() {
        let owned = json!({"id": 5, "organizationId": 7, "companyId": 9});
        assert!(row_in_scope(&owned, 7, 9));
        assert!(!row_in_scope(&owned, 8, 9));
        assert!(!row_in_scope(&owned, 7, 10));
        assert!(!row_in_scope(&json!({"id": 5, "companyId": 9}), 7, 9));
    }

    #[test]
    fn row_ids_preserve_u64() {
        assert_eq!(row_u64(&json!({"id": 18}), "id"), Some(18));
        assert_eq!(
            row_u64(&json!({"id": "18446744073709551615"}), "id"),
            Some(u64::MAX)
        );
        assert_eq!(row_u64(&json!({"id": "not-an-id"}), "id"), None);
    }

    #[test]
    fn sql_has_composite_scope_and_limit_plus_one() {
        let sql =
            build_account_moves_sql("id, organization_id, company_id", "account_move", 7, 9, 10);
        assert!(sql.contains("organization_id = 7 AND company_id = 9"));
        assert!(!sql.contains("ORDER BY"));
        assert!(sql.ends_with("LIMIT 11"));
    }

    #[test]
    fn page_rejects_bad_scope_or_duplicate_ids_and_bounds_output() {
        let rows = (1..=3)
            .map(|id| json!({"id": id, "organizationId": 7, "companyId": 9}))
            .collect();
        let page = page_from_rows(rows, 7, 9, 2).unwrap();
        assert_eq!(page.rows.len(), 2);
        assert!(page.truncated);
        let bad = vec![json!({"id": 1, "organizationId": 8, "companyId": 9})];
        assert!(page_from_rows(bad, 7, 9, 2).is_err());
        let duplicate = vec![
            json!({"id": 2, "organizationId": 7, "companyId": 9}),
            json!({"id": 2, "organizationId": 7, "companyId": 9}),
        ];
        assert!(page_from_rows(duplicate, 7, 9, 2).is_err());
    }

    #[tokio::test]
    async fn acquisition_resolves_membership_and_executes_bounded_scoped_query() {
        let membership = sats_response(&["company_id"], &[vec![9]]);
        let moves = sats_response(
            &["id", "organization_id", "company_id"],
            &[vec![1, 7, 9], vec![2, 7, 9], vec![3, 7, 9]],
        );
        let (base_url, count, queries, task) = mock_stdb(vec![membership, moves]).await;
        let context = trusted_context(&base_url);
        let page = acquire_account_moves(&context, 9, 2).await.unwrap();
        assert_eq!(page.rows.len(), 2);
        assert!(page.truncated);
        assert_eq!(count.load(Ordering::SeqCst), 2);
        let captured = queries.lock().unwrap();
        assert!(captured[0].contains("user_organization"));
        assert!(captured[1].contains("organization_id = 7 AND company_id = 9"));
        assert!(captured[1].contains("LIMIT 3"));
        task.abort();
    }

    #[tokio::test]
    async fn acquisition_denies_wrong_company_before_account_query() {
        let membership = sats_response(&["company_id"], &[vec![9]]);
        let (base_url, count, queries, task) = mock_stdb(vec![membership]).await;
        let context = trusted_context(&base_url);
        let error = acquire_account_moves(&context, 8, 2).await.unwrap_err();
        assert!(matches!(error, ApiError::Forbidden(_)));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(queries.lock().unwrap().len(), 1);
        task.abort();
    }
}
