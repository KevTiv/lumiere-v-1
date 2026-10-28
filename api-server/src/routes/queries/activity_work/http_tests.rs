//! Exercise owner-only Activity reads and actor-authorized source reads end to end.
use super::*;
use crate::session::ApiSession;
use crate::trusted_context::RESOURCE_QUERY_OPERATION_ID;
use axum::{extract::State, http::HeaderMap, routing::post, Router};
use std::sync::{Arc, Mutex};
use stdb_auth::{FieldAccessContext, FieldPermissionLike};

struct Fixture {
    rows: Vec<Value>,
    requests: Mutex<Vec<(String, String)>>,
}
struct Server {
    owner: StdbClient,
    actor: StdbClient,
    fixture: Arc<Fixture>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn sats(sql: &str, rows: Vec<Value>) -> String {
    let columns: Vec<_> = sql
        .strip_prefix("SELECT ")
        .unwrap()
        .split_once(" FROM ")
        .unwrap()
        .0
        .split(", ")
        .collect();
    json!([{"schema":{"elements":columns.iter().map(|name| json!({"name":{"some":name}})).collect::<Vec<_>>()},"rows":rows.iter().map(|row| columns.iter().map(|name| row[*name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>() }]).to_string()
}

fn row(id: u64, done: bool) -> Value {
    json!({"id":id,"organization_id":42,"summary":format!("Follow-up {id}"),"res_model":"purchase_order","res_id":id+100,
        "assigned_to":"cd".repeat(32),"is_done":done,"state":if done {"done"} else {"planned"},"auto":false,"is_system":false,"deleted_at":null,
        "note":"PRIVATE NOTE","metadata":"PRIVATE METADATA"})
}

fn clause(sql: &str, marker: &str) -> Option<u64> {
    sql.split(marker)
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse().ok())
}

async fn server() -> Server {
    async fn respond(
        State(fixture): State<Arc<Fixture>>,
        headers: HeaderMap,
        sql: String,
    ) -> String {
        let token = headers
            .get("authorization")
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
        fixture
            .requests
            .lock()
            .unwrap()
            .push((token.clone(), sql.clone()));
        let table = sql
            .split_once(" FROM ")
            .unwrap()
            .1
            .split_whitespace()
            .next()
            .unwrap();
        let rows = match table {
            "user_organization" => vec![
                json!({"id":1,"user_identity":"cd".repeat(32),"organization_id":42,"company_id":7,"role_id":2,"department_id":4,"is_active":true}),
            ],
            "user_role_assignment" => vec![],
            "role" => vec![
                json!({"id":2,"name":"Clerk","permissions":["activity:read","activity:write","purchase_order:read"],"is_active":true}),
            ],
            "company" => vec![json!({"id":7,"deleted_at":null})],
            "hr_department" => vec![json!({"id":4})],
            "activity" => {
                assert_eq!(token, "Bearer owner-token");
                assert!(sql.contains("organization_id = 42"));
                assert!(sql.contains("res_model = 'purchase_order'"));
                assert!(!sql.contains("account_payment") && !sql.contains("hr_expense_sheet"));
                assert!(!sql.contains("note") && !sql.contains("metadata"));
                let after = clause(&sql, " AND id > ").unwrap_or(0);
                let end = clause(&sql, " AND id <= ").unwrap_or(u64::MAX);
                let exact = clause(&sql, " AND id = ");
                let mut rows: Vec<_> = fixture
                    .rows
                    .iter()
                    .rev()
                    .filter(|row| {
                        let id = row["id"].as_u64().unwrap();
                        id > after && id <= end && exact.is_none_or(|exact| exact == id)
                    })
                    .cloned()
                    .collect();
                if sql.ends_with("LIMIT 1") {
                    rows.truncate(1);
                }
                rows
            }
            "purchase_order" => {
                assert_eq!(token, "Bearer actor-token");
                assert!(sql.contains("WHERE organization_id = 42 AND company_id = 7 AND id = "));
                let id = clause(&sql, " AND id = ").unwrap();
                if id == 230 {
                    vec![]
                } else {
                    vec![
                        json!({"id":id,"organization_id":42,"company_id":7,"name":format!("PO-{id}"),"state":"Draft"}),
                    ]
                }
            }
            other => panic!("unexpected SQL table {other}: {sql}"),
        };
        sats(&sql, rows)
    }
    let fixture = Arc::new(Fixture {
        rows: vec![row(1, false), row(4, true), row(130, false)],
        requests: Mutex::new(vec![]),
    });
    let router = Router::new()
        .route("/v1/database/test/sql", post(respond))
        .with_state(fixture.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Server {
        owner: StdbClient::new(
            format!("http://{address}"),
            "test".into(),
            "owner-token".into(),
        ),
        actor: StdbClient::new(
            format!("http://{address}"),
            "test".into(),
            "actor-token".into(),
        ),
        fixture,
        task,
    }
}

fn context(server: &Server, grants: &[&str]) -> TrustedOperationContext {
    context_with_fields(server, grants, vec![])
}

fn context_with_fields(
    server: &Server,
    grants: &[&str],
    field_permissions: Vec<FieldPermissionLike>,
) -> TrustedOperationContext {
    let access = FieldAccessContext {
        organization_id: 42,
        identity_hex: "cd".repeat(32),
        role_id: 2,
        role_ids: vec![2],
        role_permissions: grants.iter().map(|s| (*s).into()).collect(),
        field_permissions,
        ..FieldAccessContext::default()
    };
    TrustedOperationContext::from_session(
        &ApiSession {
            stdb_token: "actor-token".into(),
            identity_hex: "cd".repeat(32),
            organization_id: Some(42),
            field_access: Some(access),
        },
        server.actor.clone(),
        RESOURCE_QUERY_OPERATION_ID,
    )
    .unwrap()
}
fn request(cursor: Option<&str>, view: &str, exact: Option<u64>) -> ActivityWorkRequest {
    ActivityWorkRequest::parse(
        "activities",
        Some(7),
        Some("finance"),
        Some(view),
        None,
        cursor,
        Some(1),
        exact,
    )
    .unwrap()
    .unwrap()
}

#[tokio::test]
async fn manual_reader_paginates_all_statuses_and_omits_missing_sources() {
    let server = server().await;
    let context = context(
        &server,
        &["activity:read", "activity:write", "purchase_order:read"],
    );
    let first = read_activity_work(&server.owner, &context, request(None, "eligible", None))
        .await
        .unwrap();
    assert_eq!(first.rows[0]["id"], "1");
    assert_eq!(first.rows[0]["workActions"], json!(["complete"]));
    assert_eq!(first.rows[0]["assignedTo"], "cd".repeat(32));
    assert!(first.rows[0].get("note").is_none());
    assert!(first.rows[0].get("metadata").is_none());
    let second = read_activity_work(
        &server.owner,
        &context,
        request(first.next_cursor.as_deref(), "eligible", None),
    )
    .await
    .unwrap();
    assert_eq!(second.rows[0]["id"], "4");
    assert_eq!(second.rows[0]["state"], "done");
    assert_eq!(second.rows[0]["workActions"], json!([]));
    let last = read_activity_work(
        &server.owner,
        &context,
        request(second.next_cursor.as_deref(), "eligible", None),
    )
    .await
    .unwrap();
    assert!(last.rows.is_empty());
    assert!(last.next_cursor.is_none());
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|(token, sql)| token == "Bearer actor-token" && sql.contains("FROM purchase_order")));
}

#[tokio::test]
async fn explicit_field_selection_hides_assignee_and_private_content() {
    let server = server().await;
    let context = context_with_fields(
        &server,
        &["activity:read", "purchase_order:read"],
        vec![FieldPermissionLike {
            id: None,
            organization_id: Some(42),
            role_id: Some(2),
            resource: "activities".into(),
            action: "read".into(),
            allowed_fields: vec!["summary".into(), "state".into(), "is_done".into()],
            subject_user_hex: None,
            subject_role_id: None,
        }],
    );
    let page = read_activity_work(&server.owner, &context, request(None, "eligible", None))
        .await
        .unwrap();
    assert_eq!(page.rows[0]["summary"], "Follow-up 1");
    for field in ["assignedTo", "userId", "note", "metadata"] {
        assert!(page.rows[0].get(field).is_none(), "unexpected {field}");
    }
}

#[tokio::test]
async fn exact_done_readback_survives_available_view_and_scope_checks_remain() {
    let server = server().await;
    let context = context(&server, &["activity:read", "purchase_order:read"]);
    let exact = read_activity_work(&server.owner, &context, request(None, "available", Some(4)))
        .await
        .unwrap();
    assert_eq!(exact.rows[0]["state"], "done");
    assert_eq!(exact.rows[0]["workActions"], json!([]));
    let denied = context_for_no_activity_read(&server);
    assert!(matches!(
        read_activity_work(&server.owner, &denied, request(None, "eligible", None)).await,
        Err(ApiError::Forbidden(_))
    ));
    let mut company = request(None, "eligible", None);
    company.company_id = 8;
    assert!(matches!(
        read_activity_work(&server.owner, &context, company).await,
        Err(ApiError::Forbidden(_))
    ));
}
fn context_for_no_activity_read(server: &Server) -> TrustedOperationContext {
    context(server, &["purchase_order:read"])
}
