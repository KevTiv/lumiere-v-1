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
    receipts: Mutex<Vec<Value>>,
    events: Mutex<Vec<Value>>,
    resubmissions: Mutex<Vec<Value>>,
    groups: Mutex<Vec<Value>>,
    delegations: Mutex<Vec<Value>>,
    candidates: Mutex<Vec<Value>>,
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
    let (selected, from) = sql
        .strip_prefix("SELECT ")
        .unwrap()
        .split_once(" FROM ")
        .unwrap();
    let table = from.split_whitespace().next().unwrap();
    let columns: Vec<String> = if selected == "*" {
        rows.first()
            .and_then(Value::as_object)
            .map(|row| row.keys().cloned().collect())
            .unwrap_or_default()
    } else {
        selected.split(", ").map(str::to_owned).collect()
    };
    json!([{
        "schema":{"elements":columns.iter().map(|name| sats_field(table, name, &Value::Null).0).collect::<Vec<_>>()},
        "rows":rows.iter().map(|row| columns.iter().map(|name| sats_field(table, name, &row[name]).1).collect::<Vec<_>>()).collect::<Vec<_>>()
    }]).to_string()
}

/// Real SATS Option/enum/identity wire shapes, consumed by StdbClient::query_sql.
/// In particular, null acting_for and partial vote decisions must not depend
/// on fixtures already having the API's normalized JSON representation.
fn sats_field(table: &str, column: &str, value: &Value) -> (Value, Value) {
    if table == "workflow_human_task" && column == "guarded_action" {
        let keys = [
            "ConfirmPurchaseOrder",
            "SendPurchaseOrder",
            "ConfirmSalesOrder",
            "PostAccountMove",
            "PostPayment",
            "ApproveExpenseSheet",
            "ApproveAiActionDraft",
            "ApproveLeave",
            "PostPaymentTransaction",
            "ReversePaymentTransaction",
            "ReverseBankStatementSettlement",
        ];
        let product = json!({"Product":{"elements":[
            {"name":{"some":"key"},"algebraic_type":{"Sum":{"variants":keys.iter().map(|key|json!({"name":{"some":key},"algebraic_type":{"Product":{"elements":[]}}})).collect::<Vec<_>>()}}},
            {"name":{"some":"schema_version"},"algebraic_type":{"U32":[]}}
        ]}});
        let element = json!({"name":{"some":column},"algebraic_type":{"Sum":{"variants":[
            {"name":{"some":"some"},"algebraic_type":product},
            {"name":{"some":"none"},"algebraic_type":{"Product":{"elements":[]}}}
        ]}}});
        return (
            element,
            if value.is_null() {
                json!([1, []])
            } else {
                json!([0, value])
            },
        );
    }
    let enum_tags: &[&str] = match (table, column) {
        ("workflow_human_task_event" | "workflow_human_task_candidate", "decision") => {
            &["Approve", "Reject", "Complete"]
        }
        ("workflow_human_task_event", "prior_status") => &[
            "Open",
            "Claimed",
            "Approved",
            "Rejected",
            "Completed",
            "Invalidated",
            "Cancelled",
        ],
        _ => &[],
    };
    let mut element = json!({"name":{"some":column}});
    let (inner_type, inner_value) = if table == "workflow_human_task_event"
        && column == "acting_for"
    {
        (
            json!({"Product":{"elements":[{"name":{"some":"__identity__"},"algebraic_type":{"U256":[]}}]}}),
            json!([value]),
        )
    } else if !enum_tags.is_empty() {
        let tag = value
            .as_str()
            .map(|name| {
                enum_tags
                    .iter()
                    .position(|candidate| *candidate == name)
                    .unwrap()
            })
            .unwrap_or(0);
        (
            json!({"Sum":{"variants":enum_tags.iter().map(|name|json!({"name":{"some":name},"algebraic_type":{"Product":{"elements":[]}}})).collect::<Vec<_>>()}}),
            json!([tag, []]),
        )
    } else {
        return (element, value.clone());
    };
    element["algebraic_type"] = json!({"Sum":{"variants":[
        {"name":{"some":"some"},"algebraic_type":inner_type},
        {"name":{"some":"none"},"algebraic_type":{"Product":{"elements":[]}}}
    ]}});
    let wire_value = if value.is_null() {
        json!([1, []])
    } else {
        json!([0, inner_value])
    };
    (element, wire_value)
}

fn task(id: u64) -> Value {
    json!({"id":id,"organization_id":42,"company_id":7,"workflow_id":1,"workflow_version_id":1,
        "workflow_instance_id":100+id,"node_key":"approve","kind":"ApproveReject","assignment":"AnyCandidate",
        "candidate_role_ids":[2],"candidate_group_ids":[],"candidate_unit_ids":[4],"subject_model":"purchase_order",
        "subject_id":200+id,"status":"Open","revision":1,"requested_by":"ab".repeat(32),"claimed_by":null,
        "guarded_action":null,"decision_comment":"PRIVATE-COMMENT"})
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
        let delegated_principal = sql.contains(&"ef".repeat(32));
        let rows = match table {
            "user_organization" => vec![
                json!({"id":1,"organization_id":42,"company_id":7,"role_id":if delegated_principal {3} else {2},"department_id":4,"is_active":true}),
            ],
            "user_role_assignment"
            | "sod_conflict_rule"
            | "field_permission"
            | "org_permission" => vec![],
            "workflow_candidate_group_member" => fixture.groups.lock().unwrap().clone(),
            "workflow_delegation" => fixture.delegations.lock().unwrap().clone(),
            "user_profile" => vec![
                json!({"name":"Operator","organization_id":42,"is_active":true,"is_superuser":false}),
            ],
            "role" => vec![
                json!({"id":2,"organization_id":42,"name":"Reviewer","is_active":true,"permissions":["workflow:read","purchase_order:read","workflow_task:write"]}),
                json!({"id":3,"organization_id":42,"name":"Principal","is_active":true,"permissions":["workflow:read","purchase_order:read","purchase_order:write","workflow_task:*"]}),
            ],
            "company" => vec![json!({"id":7,"deleted_at":null})],
            "workflow_human_task" => {
                assert_eq!(token, "Bearer owner-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7"));
                assert!(sql.contains("subject_model = 'purchase_order'"));
                assert!(!sql.contains("sale_order"));
                assert!(!sql.contains("decision_comment"));
                let exact = sql.split(" AND id = ").nth(1).map(|tail| {
                    tail.split_whitespace()
                        .next()
                        .unwrap()
                        .parse::<u64>()
                        .unwrap()
                });
                let after = sql
                    .split(" AND id > ")
                    .nth(1)
                    .map(|tail| {
                        tail.split_whitespace()
                            .next()
                            .unwrap()
                            .parse::<u64>()
                            .unwrap()
                    })
                    .unwrap_or(0);
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
                            && exact.is_none_or(|exact| id == exact)
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
            "workflow_human_task_candidate" => fixture.candidates.lock().unwrap().clone(),
            "workflow_human_task_receipt" | "workflow_human_task_event" => {
                assert_eq!(token, "Bearer owner-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7 AND task_id = 1"));
                assert!(sql.ends_with("LIMIT 2"));
                assert!(sql.contains("input_hash = 'sha256:"));
                assert!(!sql.contains("comment"));
                assert!(!sql.contains("domain_receipt"));
                if table == "workflow_human_task_receipt" {
                    assert!(sql.contains("scope_key = '42:1:"));
                    assert!(sql.contains(&format!("created_by = 0x{}", "cd".repeat(32))));
                    fixture.receipts.lock().unwrap().clone()
                } else {
                    assert!(sql.contains("idempotency_key = 'attempt-1'"));
                    assert!(sql.contains(&format!("actor = 0x{}", "cd".repeat(32))));
                    fixture.events.lock().unwrap().clone()
                }
            }
            "workflow_human_task_resubmission" => {
                assert_eq!(token, "Bearer owner-token");
                assert!(sql
                    .contains("organization_id = 42 AND company_id = 7 AND previous_task_id = 1"));
                assert!(!sql.contains("reason"));
                assert!(!sql.contains("correlation_id"));
                if sql.ends_with("LIMIT 2") {
                    assert!(sql.contains("scope_key = '42:7:9:attempt-1'"));
                    assert!(sql.contains(&format!("created_by = 0x{}", "cd".repeat(32))));
                    assert!(sql.contains("input_hash = 'sha256:"));
                }
                fixture.resubmissions.lock().unwrap().clone()
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
                let cancelled = fixture
                    .tasks
                    .iter()
                    .any(|row| row["workflow_instance_id"] == id && row["status"] == "Cancelled");
                vec![
                    json!({"id":id,"revision":3,"state":if cancelled {"Cancelled"} else {"Active"}}),
                ]
            }
            other => panic!("unexpected fixture table {other}: {sql}"),
        };
        sats_reply(&sql, rows)
    }
    let fixture = Arc::new(Fixture {
        tasks,
        source_exists,
        receipts: Mutex::new(Vec::new()),
        events: Mutex::new(Vec::new()),
        resubmissions: Mutex::new(Vec::new()),
        groups: Mutex::new(Vec::new()),
        delegations: Mutex::new(Vec::new()),
        candidates: Mutex::new(Vec::new()),
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

fn exact_request(view: &str, kind: &str, acting_for: Option<&str>) -> WorkBoardRequest {
    WorkBoardRequest::parse(
        "workflow-human-tasks",
        Some(7),
        Some("finance"),
        Some(view),
        None,
        None,
        Some(50),
    )
    .unwrap()
    .unwrap()
    .with_readback(
        WorkTaskReadbackRequest::parse(
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some(kind),
            Some("attempt-1"),
            Some(&format!("sha256:{}", "12".repeat(32))),
            acting_for,
        )
        .unwrap(),
    )
    .unwrap()
}

fn install_command(
    server: &MockServer,
    kind: &str,
    decision: Option<&str>,
    principal: Option<&str>,
) {
    let (status, tag, prior_status) = match kind {
        "claim" => ("Claimed", "Claim", "Open"),
        "resubmit" => ("Cancelled", "Resubmit", "Cancelled"),
        _ => ("Open", "Decision", "Open"),
    };
    *server.fixture.receipts.lock().unwrap() = vec![json!({
        "scope_key":format!("42:1:{kind}:attempt-1"), "organization_id":42, "company_id":7,
        "task_id":1, "command_kind":tag, "idempotency_key":"attempt-1",
        "input_hash":format!("sha256:{}", "12".repeat(32)), "result_status":status,
        "result_revision":2, "created_by":"cd".repeat(32), "domain_receipt":"PRIVATE BUSINESS PAYLOAD"
    })];
    *server.fixture.events.lock().unwrap() = vec![json!({
        "id":10, "organization_id":42, "company_id":7, "task_id":1, "workflow_instance_id":101,
        "command_kind":tag, "idempotency_key":"attempt-1", "input_hash":format!("sha256:{}", "12".repeat(32)),
        "prior_status":prior_status, "next_status":status, "prior_revision":1, "next_revision":2,
        "decision":decision, "actor":"cd".repeat(32), "acting_for":principal, "comment":"PRIVATE COMMENT"
    })];
}

#[tokio::test]
async fn recovery_hint_and_exact_link_preserve_current_authority_and_hide_private_data() {
    let mut cancelled = task(1);
    cancelled["status"] = json!("Cancelled");
    cancelled["revision"] = json!(2);
    cancelled["subject_revision_hash"] = json!("material-hash");
    cancelled["guarded_action"] = json!([[0, []], 1]);
    let server = mock_server_rows(vec![cancelled.clone()], true).await;
    let grants = [
        "workflow:read",
        "workflow_instance:create",
        "workflow_task:write",
        "purchase_order:read",
        "purchase_order:write",
    ];
    let actor = context(&server, access(&grants));
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!(["resubmit"]));
    assert!(page.rows[0].get("guarded_action").is_none());
    assert!(page.rows[0].get("guardedAction").is_none());
    for missing in [
        "workflow_instance:create",
        "workflow_task:write",
        "purchase_order:write",
    ] {
        let restricted: Vec<_> = grants
            .iter()
            .copied()
            .filter(|grant| *grant != missing)
            .collect();
        let page = read_work_board(
            &server.owner,
            &context(&server, access(&restricted)),
            request(None, 50),
        )
        .await
        .unwrap();
        assert_eq!(page.rows[0]["workActions"], json!([]), "{missing}");
    }

    install_command(&server, "resubmit", None, None);
    let link = json!({
        "previous_task_id":1, "scope_key":"42:7:9:attempt-1", "organization_id":42, "company_id":7,
        "expected_task_revision":1, "expected_instance_revision":3, "expected_subject_revision_hash":"material-hash",
        "result_task_revision":2, "event_id":10, "successor_task_id":2, "successor_instance_id":102,
        "successor_task_revision":1, "successor_instance_revision":2, "idempotency_key":"attempt-1",
        "input_hash":format!("sha256:{}", "12".repeat(32)), "created_by":"cd".repeat(32),
        "reason":"PRIVATE REASON", "correlation_id":"PRIVATE CORRELATION",
    });
    *server.fixture.resubmissions.lock().unwrap() = vec![link.clone()];
    let page = read_work_board(
        &server.owner,
        &actor,
        exact_request("available", "resubmit", None),
    )
    .await
    .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!([]));
    let evidence = page.command_evidence.unwrap();
    assert_eq!(evidence["commandKind"], "resubmit");
    assert_eq!(evidence["eventId"], "10");
    assert_eq!(evidence["resultStatus"], "Cancelled");
    assert_eq!(evidence["successorTaskId"], "2");
    assert_eq!(evidence["successorInstanceId"], "102");
    assert!(!evidence.to_string().contains("PRIVATE"));
    for (field, value) in [
        ("created_by", json!("ef".repeat(32))),
        ("event_id", json!(11)),
        ("result_task_revision", json!(3)),
        ("successor_task_id", json!(1)),
    ] {
        let mut changed = link.clone();
        changed[field] = value;
        *server.fixture.resubmissions.lock().unwrap() = vec![changed];
        assert!(
            read_work_board(
                &server.owner,
                &actor,
                exact_request("eligible", "resubmit", None)
            )
            .await
            .unwrap()
            .command_evidence
            .is_none(),
            "{field}"
        );
    }
    *server.fixture.resubmissions.lock().unwrap() = vec![link];
    let restricted = context(
        &server,
        access(&[
            "workflow:read",
            "workflow_task:write",
            "purchase_order:read",
            "purchase_order:write",
        ]),
    );
    assert!(read_work_board(
        &server.owner,
        &restricted,
        exact_request("eligible", "resubmit", None)
    )
    .await
    .unwrap()
    .command_evidence
    .is_none());
    let unreadable = context(
        &server,
        access(&[
            "workflow:read",
            "workflow_task:write",
            "workflow_instance:create",
            "purchase_order:write",
        ]),
    );
    let page = read_work_board(
        &server.owner,
        &unreadable,
        exact_request("eligible", "resubmit", None),
    )
    .await
    .unwrap();
    assert!(page.rows.is_empty());
    assert!(page.command_evidence.is_none());

    cancelled["candidate_role_ids"] = json!([99]);
    cancelled["candidate_unit_ids"] = json!([]);
    let hidden = mock_server_rows(vec![cancelled], true).await;
    let page = read_work_board(
        &hidden.owner,
        &context(&hidden, access(&grants)),
        exact_request("eligible", "resubmit", None),
    )
    .await
    .unwrap();
    assert!(page.rows.is_empty());
    assert!(page.command_evidence.is_none());
}

#[tokio::test]
async fn exact_claim_readback_escapes_available_view_and_requires_unique_matching_evidence() {
    let mut claimed = task(1);
    claimed["status"] = json!("Claimed");
    claimed["revision"] = json!(2);
    claimed["claimed_by"] = json!("cd".repeat(32));
    let server = mock_server_rows(vec![claimed], true).await;
    install_command(&server, "claim", None, None);
    let actor = context(
        &server,
        access(&[
            "workflow:read",
            "purchase_order:read",
            "workflow_task:write",
        ]),
    );
    let page = read_work_board(
        &server.owner,
        &actor,
        exact_request("available", "claim", None),
    )
    .await
    .unwrap();
    assert_eq!(page.rows.len(), 1);
    assert!(page.next_cursor.is_none());
    let evidence = page.command_evidence.unwrap();
    assert_eq!(evidence["resultRevision"], "2");
    assert_eq!(evidence["resultStatus"], "Claimed");
    assert_eq!(evidence["taskId"], "1");
    assert!(!evidence.to_string().contains("PRIVATE"));
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, sql)| sql.contains("FROM workflow_human_task "))
        .all(|(_, sql)| sql.contains("AND id = 1 LIMIT 2")));

    let receipt = server.fixture.receipts.lock().unwrap()[0].clone();
    let event = server.fixture.events.lock().unwrap()[0].clone();
    for duplicate_receipt in [true, false] {
        *server.fixture.receipts.lock().unwrap() = if duplicate_receipt {
            vec![receipt.clone(), receipt.clone()]
        } else {
            vec![receipt.clone()]
        };
        *server.fixture.events.lock().unwrap() = if duplicate_receipt {
            vec![event.clone()]
        } else {
            vec![event.clone(), event.clone()]
        };
        let page = read_work_board(
            &server.owner,
            &actor,
            exact_request("available", "claim", None),
        )
        .await
        .unwrap();
        assert_eq!(page.rows.len(), 1);
        assert!(page.command_evidence.is_none());
    }
    *server.fixture.events.lock().unwrap() = vec![event];
    *server.fixture.receipts.lock().unwrap() = vec![receipt];
    let mut changed_input = exact_request("available", "claim", None);
    changed_input.readback = WorkTaskReadbackRequest::parse(
        "workflow-human-tasks",
        Some("finance"),
        Some(1),
        Some("claim"),
        Some("attempt-1"),
        Some(&format!("sha256:{}", "34".repeat(32))),
        None,
    )
    .unwrap();
    assert!(read_work_board(&server.owner, &actor, changed_input)
        .await
        .unwrap()
        .command_evidence
        .is_none());
}

#[tokio::test]
async fn exact_partial_votes_confirm_only_the_actual_actor_even_when_row_revision_is_later() {
    for decision in ["Approve", "Complete"] {
        let mut voted = task(1);
        voted["assignment"] = json!("AllCandidates");
        voted["kind"] = json!(if decision == "Approve" {
            "ApproveReject"
        } else {
            "Complete"
        });
        voted["revision"] = json!(4);
        let server = mock_server_rows(vec![voted], true).await;
        *server.fixture.candidates.lock().unwrap() =
            vec![json!({"candidate_identity":"cd".repeat(32),"decision":decision})];
        install_command(&server, "decision", Some(decision), None);
        let actor = context(
            &server,
            access(&["workflow:read", "purchase_order:read", "workflow_task:*"]),
        );
        let page = read_work_board(
            &server.owner,
            &actor,
            exact_request("mine", "decision", None),
        )
        .await
        .unwrap();
        assert_eq!(page.rows[0]["revision"], 4);
        assert_eq!(page.rows[0]["workActions"], json!([]));
        let evidence = page.command_evidence.unwrap();
        assert_eq!(evidence["resultStatus"], "Open");
        assert_eq!(evidence["resultRevision"], "2");
        assert_eq!(evidence["decision"], decision.to_ascii_lowercase());
        server.fixture.events.lock().unwrap()[0]["actor"] = json!("ef".repeat(32));
        let page = read_work_board(
            &server.owner,
            &actor,
            exact_request("mine", "decision", None),
        )
        .await
        .unwrap();
        assert_eq!(page.rows.len(), 1);
        assert!(page.command_evidence.is_none());
        server.fixture.receipts.lock().unwrap().clear();
        assert!(read_work_board(
            &server.owner,
            &actor,
            exact_request("mine", "decision", None)
        )
        .await
        .unwrap()
        .command_evidence
        .is_none());
    }
}

#[tokio::test]
async fn exact_evidence_rechecks_candidate_and_action_access_and_never_outlives_source_read() {
    let mut claimed = task(1);
    claimed["candidate_role_ids"] = json!([99]);
    claimed["candidate_group_ids"] = json!([9]);
    claimed["candidate_unit_ids"] = json!([]);
    claimed["status"] = json!("Claimed");
    claimed["revision"] = json!(2);
    claimed["claimed_by"] = json!("cd".repeat(32));
    let server = mock_server_rows(vec![claimed], true).await;
    let membership = json!({"group_id":9,"company_id":7,"is_active":true});
    *server.fixture.groups.lock().unwrap() = vec![membership.clone()];
    install_command(&server, "claim", None, None);
    let actor = context(
        &server,
        access(&[
            "workflow:read",
            "purchase_order:read",
            "workflow_task:write",
        ]),
    );
    assert!(
        read_work_board(&server.owner, &actor, exact_request("mine", "claim", None))
            .await
            .unwrap()
            .command_evidence
            .is_some()
    );

    server.fixture.groups.lock().unwrap().clear();
    server.fixture.requests.lock().unwrap().clear();
    let page = read_work_board(&server.owner, &actor, exact_request("mine", "claim", None))
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 1); // Existing claimant retains read-only assignment visibility.
    assert_eq!(page.rows[0]["workActions"], json!([]));
    assert!(page.command_evidence.is_none());
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, sql)| !sql.contains("FROM workflow_human_task_receipt ")));

    *server.fixture.groups.lock().unwrap() = vec![membership];
    let reader = context(&server, access(&["workflow:read", "purchase_order:read"]));
    assert!(
        read_work_board(&server.owner, &reader, exact_request("mine", "claim", None))
            .await
            .unwrap()
            .command_evidence
            .is_none()
    );
    server.fixture.requests.lock().unwrap().clear();
    let denied = context(&server, access(&["workflow:read", "workflow_task:write"]));
    let page = read_work_board(&server.owner, &denied, exact_request("mine", "claim", None))
        .await
        .unwrap();
    assert!(page.rows.is_empty());
    assert!(page.command_evidence.is_none());
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(
            |(_, sql)| !sql.contains("FROM workflow_human_task_receipt ")
                && !sql.contains("FROM workflow_human_task_event ")
        ));
}

#[tokio::test]
async fn delegated_exact_evidence_requires_the_bound_principal_and_a_current_grant() {
    let principal = "ef".repeat(32);
    let mut claimed = task(1);
    claimed["candidate_role_ids"] = json!([3]);
    claimed["candidate_unit_ids"] = json!([]);
    claimed["status"] = json!("Claimed");
    claimed["revision"] = json!(2);
    claimed["claimed_by"] = json!("cd".repeat(32));
    let server = mock_server_rows(vec![claimed], true).await;
    *server.fixture.delegations.lock().unwrap() = vec![json!({
        "delegator_identity":principal, "company_id":7, "role_id":3,
        "is_active":true,"valid_from":0,"valid_until":i64::MAX
    })];
    install_command(&server, "claim", None, Some(&principal));
    let actor = context(&server, access(&["workflow:read", "purchase_order:read"]));
    let page = read_work_board(
        &server.owner,
        &actor,
        exact_request("mine", "claim", Some(&principal)),
    )
    .await
    .unwrap();
    assert_eq!(
        page.command_evidence.unwrap()["actingForIdentityHex"],
        principal
    );
    assert!(
        read_work_board(&server.owner, &actor, exact_request("mine", "claim", None))
            .await
            .unwrap()
            .command_evidence
            .is_none()
    );
    server.fixture.delegations.lock().unwrap().clear();
    server.fixture.requests.lock().unwrap().clear();
    let page = read_work_board(
        &server.owner,
        &actor,
        exact_request("mine", "claim", Some(&principal)),
    )
    .await
    .unwrap();
    assert_eq!(page.rows.len(), 1);
    assert!(page.command_evidence.is_none());
    assert!(server
        .fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, sql)| !sql.contains("FROM workflow_human_task_receipt ")));
}

#[tokio::test]
async fn final_guarded_approve_requires_actor_operation_permission_and_never_projects_guard() {
    let mut guarded = task(1);
    guarded["guarded_action"] = json!([[0, []], 1]); // ConfirmPurchaseOrder, schema 1.
    let server = mock_server_rows(vec![guarded], true).await;
    let permissions = ["workflow:read", "purchase_order:read", "workflow_task:*"];
    let reviewer = context(&server, access(&permissions));
    let page = read_work_board(&server.owner, &reviewer, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!(["claim", "reject"]));
    assert!(page.rows[0].get("guardedAction").is_none());
    assert!(page.rows[0].get("guarded_action").is_none());
    assert!(!page.rows[0].to_string().contains("ConfirmPurchaseOrder"));

    let mut allowed = access(&permissions);
    allowed.role_permissions.push("purchase_order:write".into());
    let actor = context(&server, allowed.clone());
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    // No blanket inventory grants: this is the adapter's necessary top-level permission.
    assert_eq!(
        page.rows[0]["workActions"],
        json!(["claim", "approve", "reject"])
    );
    allowed.org_permissions.push(stdb_auth::ActionPermission {
        resource: "purchase_order".into(),
        action: "write".into(),
        allow: false,
    });
    let actor = context(&server, allowed);
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!(["claim", "reject"]));
}

#[tokio::test]
async fn delegated_guarded_approve_uses_actual_actor_domain_permissions() {
    let principal = "ef".repeat(32);
    let mut guarded = task(1);
    guarded["guarded_action"] = json!([[0, []], 1]);
    guarded["candidate_role_ids"] = json!([3]);
    guarded["candidate_unit_ids"] = json!([]);
    let server = mock_server_rows(vec![guarded], true).await;
    *server.fixture.delegations.lock().unwrap() = vec![json!({
        "delegator_identity":principal,"company_id":7,"role_id":3,
        "is_active":true,"valid_from":0,"valid_until":i64::MAX
    })];
    let actor = context(&server, access(&["workflow:read", "purchase_order:read"]));
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!([]));
    // The delegated principal has PO write; that grant cannot authorize the actor's adapter.
    assert_eq!(
        page.rows[0]["actingForOptions"][0]["workActions"],
        json!(["claim", "reject"])
    );
    let actor = context(
        &server,
        access(&[
            "workflow:read",
            "purchase_order:read",
            "purchase_order:write",
        ]),
    );
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(
        page.rows[0]["actingForOptions"][0]["workActions"],
        json!(["claim", "approve", "reject"])
    );
}

#[tokio::test]
async fn guarded_quorum_filter_preserves_partial_votes_and_past_command_evidence() {
    let mut guarded = task(1);
    guarded["guarded_action"] = json!([[0, []], 1]);
    guarded["assignment"] = json!("AllCandidates");
    guarded["revision"] = json!(2);
    let server = mock_server_rows(vec![guarded], true).await;
    let caller = "cd".repeat(32);
    let other = "ef".repeat(32);
    *server.fixture.candidates.lock().unwrap() = vec![
        json!({"candidate_identity":caller,"decision":null}),
        json!({"candidate_identity":other,"decision":null}),
    ];
    let actor = context(
        &server,
        access(&[
            "workflow:read",
            "purchase_order:read",
            "workflow_task:approve",
            "workflow_task:reject",
        ]),
    );
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!(["approve", "reject"]));
    server.fixture.candidates.lock().unwrap()[1]["decision"] = json!("Approve");
    let page = read_work_board(&server.owner, &actor, request(None, 50))
        .await
        .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!(["reject"]));

    // Own earlier partial vote remains provable after another reviewer reaches
    // quorum, without prospective PO write permission on the current actor.
    let mut completed = task(1);
    completed["guarded_action"] = json!([[0, []], 1]);
    completed["assignment"] = json!("AllCandidates");
    completed["status"] = json!("Approved");
    completed["revision"] = json!(3);
    let server = mock_server_rows(vec![completed], true).await;
    *server.fixture.candidates.lock().unwrap() = vec![
        json!({"candidate_identity":caller,"decision":"Approve"}),
        json!({"candidate_identity":other,"decision":"Approve"}),
    ];
    install_command(&server, "decision", Some("Approve"), None);
    let actor = context(
        &server,
        access(&[
            "workflow:read",
            "purchase_order:read",
            "workflow_task:approve",
        ]),
    );
    let page = read_work_board(
        &server.owner,
        &actor,
        exact_request("eligible", "decision", None),
    )
    .await
    .unwrap();
    assert_eq!(page.rows[0]["workActions"], json!([]));
    assert!(page.command_evidence.is_some());
    assert!(page.rows[0].get("guardedAction").is_none());
}
