//! Exercise the real scoped reader and SATS client against an HTTP fixture.
use super::*;
use crate::session::ApiSession;
use crate::trusted_context::RESOURCE_QUERY_OPERATION_ID;
use crate::workflow_reads::bounded_windows::MAX_SEEK_PROBES;
use axum::{extract::State, http::HeaderMap, routing::post, Router};
use std::sync::{Arc, Mutex};

struct Fixture {
    tasks: Vec<Value>,
    source_exists: bool,
    requests: Mutex<Vec<(String, String)>>,
}

struct MockServer {
    owner: StdbClient,
    actor: StdbClient,
    fixture: Arc<Fixture>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.server.abort();
    }
}

fn sats_reply(sql: &str, rows: Vec<Value>) -> String {
    let columns: Vec<_> = sql
        .strip_prefix("SELECT ")
        .unwrap()
        .split_once(" FROM ")
        .unwrap()
        .0
        .split(", ")
        .collect();
    json!([{
        "schema":{"elements":columns.iter().map(|name| json!({"name":{"some":name}})).collect::<Vec<_>>()},
        "rows":rows.iter().map(|row| columns.iter().map(|name| row[*name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()
    }]).to_string()
}

fn task(id: u64) -> Value {
    json!({"id":id,"organization_id":42,"company_id":7,"workflow_id":1,"workflow_version_id":1,
        "workflow_instance_id":100+id,"node_key":"approve","kind":"ApproveReject","assignment":"AnyCandidate",
        "candidate_role_ids":[2],"candidate_group_ids":[],"candidate_unit_ids":[4],"subject_model":"purchase_order",
        "subject_id":200+id,"status":"Open","revision":1,"requested_by":"ab".repeat(32),"claimed_by":null,
        "guarded_action":{"input":"PRIVATE-SOURCE-PAYLOAD"},"decision_comment":"PRIVATE-COMMENT"})
}

async fn mock_server(ids: &[u64], source_exists: bool) -> MockServer {
    mock_server_rows(ids.iter().copied().map(task).collect(), source_exists).await
}

async fn mock_server_rows(tasks: Vec<Value>, source_exists: bool) -> MockServer {
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
            .to_string();
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
                json!({"id":1,"organization_id":42,"company_id":7,"role_id":2,"department_id":4,"is_active":true}),
            ],
            "user_role_assignment"
            | "workflow_candidate_group_member"
            | "workflow_delegation"
            | "sod_conflict_rule" => vec![],
            "user_profile" => vec![json!({"name":"Operator","is_active":true})],
            "role" => vec![
                json!({"id":2,"name":"Reviewer","is_active":true,"permissions":["workflow:read","purchase_order:read","workflow_task:write"]}),
            ],
            "company" => vec![json!({"id":7,"deleted_at":null})],
            "workflow_human_task" => {
                assert_eq!(token, "Bearer owner-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7"));
                assert!(sql.contains("subject_model = 'purchase_order'"));
                assert!(!sql.contains("sale_order"));
                assert!(!sql.contains("guarded_action"));
                assert!(!sql.contains("decision_comment"));
                let after = sql
                    .split(" AND id > ")
                    .nth(1)
                    .unwrap()
                    .split_whitespace()
                    .next()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap();
                let end = sql
                    .split(" AND id <= ")
                    .nth(1)
                    .map(|tail| {
                        tail.split_whitespace()
                            .next()
                            .unwrap()
                            .parse::<u64>()
                            .unwrap()
                    })
                    .unwrap_or(u64::MAX);
                let mut rows: Vec<_> = fixture
                    .tasks
                    .iter()
                    .rev()
                    .filter(|row| {
                        let id = row["id"].as_u64().unwrap();
                        id > after
                            && id <= end
                            && row["organization_id"] == 42
                            && row["company_id"] == 7
                            && row["subject_model"] == "purchase_order"
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
                let id = sql.rsplit("id = ").next().unwrap().parse::<u64>().unwrap();
                if fixture.source_exists {
                    vec![
                        json!({"id":id,"organization_id":42,"company_id":7,"name":format!("PO-{id}"),"state":"Draft"}),
                    ]
                } else {
                    vec![]
                }
            }
            "workflow_instance" => {
                assert_eq!(token, "Bearer owner-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7"));
                let id = sql
                    .rsplit("id = ")
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .next()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap();
                vec![json!({"id":id,"revision":3})]
            }
            other => panic!("unexpected fixture table {other}: {sql}"),
        };
        sats_reply(&sql, rows)
    }
    let fixture = Arc::new(Fixture {
        tasks,
        source_exists,
        requests: Mutex::new(Vec::new()),
    });
    let router = Router::new()
        .route("/v1/database/test/sql", post(respond))
        .with_state(fixture.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    MockServer {
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
        server,
    }
}

fn access(grants: &[&str]) -> FieldAccessContext {
    FieldAccessContext {
        organization_id: 42,
        identity_hex: "cd".repeat(32),
        role_id: 2,
        role_ids: vec![2],
        role_permissions: grants.iter().map(|grant| (*grant).into()).collect(),
        ..FieldAccessContext::default()
    }
}

fn context(server: &MockServer, access: FieldAccessContext) -> TrustedOperationContext {
    let session = ApiSession {
        stdb_token: "actor-token".into(),
        identity_hex: "cd".repeat(32),
        organization_id: Some(42),
        field_access: Some(access),
    };
    TrustedOperationContext::from_session(
        &session,
        server.actor.clone(),
        RESOURCE_QUERY_OPERATION_ID,
    )
    .unwrap()
}

fn request(cursor: Option<&str>, limit: u32) -> WorkBoardRequest {
    WorkBoardRequest::parse(
        "workflow-human-tasks",
        Some(7),
        Some("finance"),
        Some("eligible"),
        None,
        cursor,
        Some(limit),
    )
    .unwrap()
    .unwrap()
}

#[tokio::test]
async fn real_reader_pages_without_skipping_unordered_rows_and_uses_actor_source_token() {
    let server = mock_server(&[1, 2], true).await;
    let actor = context(
        &server,
        access(&[
            "workflow:read",
            "purchase_order:read",
            "workflow_task:write",
        ]),
    );
    let first = read_work_board(&server.owner, &actor, request(None, 1))
        .await
        .unwrap();
    assert_eq!(first.rows.len(), 1);
    assert_eq!(first.rows[0]["id"], 1);
    assert_eq!(first.rows[0]["workSourceTitle"], "PO-201");
    assert_eq!(first.rows[0]["workActions"], json!(["claim"]));
    assert_eq!(first.rows[0]["instanceRevision"], 3);
    assert!(!first.rows[0].to_string().contains("PRIVATE"));
    let second = read_work_board(
        &server.owner,
        &actor,
        request(first.next_cursor.as_deref(), 1),
    )
    .await
    .unwrap();
    assert_eq!(second.rows[0]["id"], 2);
    assert_eq!(second.next_cursor, None);
}

#[tokio::test]
async fn source_field_denial_removes_title_and_read_only_actor_has_no_actions() {
    let server = mock_server(&[1], true).await;
    let mut field_access = access(&["workflow:read", "purchase_order:read"]);
    field_access.field_permissions.push(serde_json::from_value(json!({"organizationId":42,"roleId":2,"resource":"purchase-orders","action":"read","allowedFields":["state"]})).unwrap());
    let actor = context(&server, field_access);
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 1);
    assert!(page.rows[0].get("workSourceTitle").is_none());
    assert_eq!(page.rows[0]["workActions"], json!([]));
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, sql)| sql.contains("FROM purchase_order "))
        .all(|(_, sql)| !sql.contains("name")));
}

#[tokio::test]
async fn missing_or_unreadable_sources_never_produce_cards() {
    let server = mock_server(&[1], false).await;
    let actor = context(&server, access(&["workflow:read", "purchase_order:read"]));
    assert!(read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap()
        .rows
        .is_empty());
    server.fixture.requests.lock().unwrap().clear();
    let actor = context(&server, access(&["workflow:read"]));
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert!(page.rows.is_empty());
    assert!(page.next_cursor.is_none());
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, sql)| !sql.contains("FROM workflow_human_task ")));
}

#[tokio::test]
async fn foreign_company_is_rejected_before_any_owner_task_or_source_read() {
    let server = mock_server(&[1], true).await;
    let actor = context(&server, access(&["workflow:read", "purchase_order:read"]));
    let mut board = request(None, 50);
    board.company_id = 8;
    assert!(matches!(
        read_work_board(&server.owner, &actor, board).await,
        Err(ApiError::Forbidden(_))
    ));
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, sql)| !sql.contains("FROM workflow_human_task ")
            && !sql.contains("FROM purchase_order ")));
}

#[tokio::test]
async fn sparse_ids_seek_without_skipping_authorized_rows_or_exposing_foreign_rows() {
    let mut foreign_org = task(1);
    foreign_org["organization_id"] = json!(43);
    let mut foreign_company = task(999_998);
    foreign_company["company_id"] = json!(8);
    let mut ineligible = task(999_999);
    ineligible["candidate_role_ids"] = json!([99]);
    ineligible["candidate_unit_ids"] = json!([]);
    let mut terminal = task(9_000_000);
    terminal["status"] = json!("Approved");
    let server = mock_server_rows(
        vec![
            foreign_org,
            foreign_company,
            ineligible,
            task(1_000_000),
            task(1_000_001),
            terminal,
        ],
        true,
    )
    .await;
    let actor = context(&server, access(&["workflow:read", "purchase_order:read"]));
    let first = read_work_board(&server.owner, &actor, request(None, 2))
        .await
        .unwrap();
    assert_eq!(
        first
            .rows
            .iter()
            .map(|row| row["id"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![1_000_000, 1_000_001]
    );
    assert!(first.next_cursor.is_some());
    let second = read_work_board(
        &server.owner,
        &actor,
        request(first.next_cursor.as_deref(), 2),
    )
    .await
    .unwrap();
    assert_eq!(
        second
            .rows
            .iter()
            .map(|row| row["id"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![9_000_000]
    );
    assert_eq!(second.rows[0]["workActions"], json!([]));
    assert!(second.next_cursor.is_none());
    let requests = server.fixture.requests.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|(_, sql)| sql.contains("FROM purchase_order "))
            .count(),
        3
    );
    assert!(
        requests
            .iter()
            .filter(|(_, sql)| sql.contains("FROM workflow_human_task "))
            .count()
            < 60
    );
}

#[tokio::test]
async fn maximum_sparse_id_still_has_a_bounded_first_page() {
    let id = u64::MAX - 300;
    let server = mock_server(&[id], true).await;
    let actor = context(&server, access(&["workflow:read", "purchase_order:read"]));
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 1);
    assert_eq!(page.rows[0]["id"], id);
    assert!(page.next_cursor.is_none());
    assert!(
        server
            .fixture
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, sql)| sql.contains("FROM workflow_human_task "))
            .count()
            <= MAX_SEEK_PROBES + MAX_WINDOWS * 2 + 1
    );
}
