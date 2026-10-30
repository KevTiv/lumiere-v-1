use super::*;
use crate::session::ApiSession;
use crate::trusted_context::RESOURCE_QUERY_OPERATION_ID;
use axum::{extract::State, http::HeaderMap, routing::post};
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

const ACTOR: &str = "abababababababababababababababababababababababababababababababab";
const GRANTS: &[&str] = &[
    "business_history:read",
    "account_move:read",
    "account_move_line:read",
];

#[tokio::test]
async fn history_router_prevents_caching_for_auth_and_extractor_rejections() {
    use crate::session::test_support::test_config;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use tower_cookies::CookieManagerLayer;

    let app = router()
        .with_state(Arc::new(AppState::new(test_config(Some("owner-token")))))
        .layer(CookieManagerLayer::new());
    for (uri, status) in [
        (
            "/history/account-moves/9?companyId=7",
            StatusCode::UNAUTHORIZED,
        ),
        (
            "/history/account-moves/9?companyId=invalid",
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(
            response.headers().get(CACHE_CONTROL).unwrap(),
            "private, no-store"
        );
    }
}

fn access(grants: &[&str], fields: Option<&[&str]>) -> FieldAccessContext {
    let mut access = FieldAccessContext {
        organization_id: 42,
        identity_hex: ACTOR.into(),
        role_id: 2,
        role_ids: vec![2],
        role_permissions: grants.iter().map(|grant| (*grant).into()).collect(),
        ..FieldAccessContext::default()
    };
    if let Some(fields) = fields {
        access.field_permissions.push(serde_json::from_value(json!({
            "organizationId":42,"roleId":2,"resource":"account-move-lines","action":"read","allowedFields":fields
        })).unwrap());
    }
    access
}

fn request(cursor: Option<String>, limit: u32) -> HistoryQuery {
    HistoryQuery {
        company_id: 7,
        cursor,
        limit: Some(limit),
    }
}

fn evidence(id: u64, changes: Value) -> Value {
    json!({"id":id,"organization_id":42,"company_id":7,"resource":"account_move","record_id":9,
        "subject_resource":"account_move_line","subject_record_id":10,"operation":OPERATION,
        "actor_identity":ACTOR,"occurred_at":1_762_000_000_123_456_i64,"schema_version":1,
        "changes_json":changes.to_string()})
}

#[test]
fn private_evidence_is_field_projected_without_metadata_or_hidden_field_names() {
    let row = evidence(
        1,
        json!([
            {"field":"debit","before":"9007199254740993.10","after":"9007199254740993.20"},
            {"field":"name","before":"PRIVATE-BEFORE","after":"PRIVATE-AFTER"},
            {"field":"metadata","before":null,"after":"PRIVATE-METADATA"}
        ]),
    );
    let fields = require_access(&access(GRANTS, Some(&["debit"]))).unwrap();
    let entry = project_entry(&row, 42, 7, 9, &fields).unwrap().unwrap();
    let encoded = serde_json::to_string(&entry).unwrap();
    assert_eq!(entry.changes.len(), 1);
    assert_eq!(
        entry.changes[0].after.as_deref(),
        Some("9007199254740993.20")
    );
    assert_eq!(entry.occurred_at, "2025-11-01T12:26:40.123456Z");
    assert!(!encoded.contains("PRIVATE"));
    assert!(!encoded.contains("metadata"));
    assert!(!encoded.contains("fingerprint"));
    assert!(!encoded.contains("audit"));
    assert!(project_entry(&row, 42, 7, 9, &HashSet::new())
        .unwrap()
        .is_none());
}

#[test]
fn explicit_line_additions_preserve_account_currency_and_lifecycle_without_widening_fields() {
    let mut row = evidence(
        2,
        json!([
            {"field":"account_id","before":null,"after":"18446744073709551615"},
            {"field":"currency_id","before":null,"after":"9007199254740993"},
            {"field":"debit","before":null,"after":"0"}
        ]),
    );
    row["operation"] = json!(ADD_OPERATION);
    let fields = require_access(&access(GRANTS, Some(&["account_id", "debit"]))).unwrap();
    let entry = project_entry(&row, 42, 7, 9, &fields).unwrap().unwrap();
    assert_eq!(entry.operation, ADD_OPERATION);
    assert_eq!(entry.changes.len(), 2);
    assert_eq!(
        entry.changes[0].after.as_deref(),
        Some("18446744073709551615")
    );
    assert!(!serde_json::to_string(&entry)
        .unwrap()
        .contains("currency_id"));
    row["changes_json"] = json!(json!([{"field":"debit","before":"0","after":"1"}]).to_string());
    assert!(project_entry(&row, 42, 7, 9, &fields).is_err());
}

#[test]
fn source_and_history_grants_are_separate_and_denies_apply() {
    for grants in [
        &[][..],
        &["audit_log:read"][..],
        &["account_move:read", "account_move_line:read"][..],
        &["business_history:read", "account_move:read"][..],
    ] {
        assert!(matches!(
            require_access(&access(grants, None)),
            Err(ApiError::Forbidden(_))
        ));
    }
    let mut access = access(GRANTS, None);
    access.org_permissions.push(stdb_auth::ActionPermission {
        resource: "business_history".into(),
        action: "read".into(),
        allow: false,
    });
    assert!(matches!(
        require_access(&access),
        Err(ApiError::Forbidden(_))
    ));
}

#[test]
fn invalid_scope_schema_payload_or_duplicate_fields_fail_closed() {
    let original = evidence(1, json!([{"field":"debit","before":"0","after":"10"}]));
    let fields = HashSet::from(["debit".into()]);
    for (key, value) in [
        ("organization_id", json!(43)),
        ("company_id", json!(8)),
        ("record_id", json!(11)),
        ("schema_version", json!(2)),
        ("resource", json!("audit_log")),
        ("operation", json!("log_audit_event")),
        ("subject_resource", json!("contact")),
        ("actor_identity", json!("forged")),
    ] {
        let mut row = original.clone();
        row[key] = value;
        assert!(project_entry(&row, 42, 7, 9, &fields).is_err(), "{key}");
    }
    for changes in [
        json!([{"field":"debit","before":0,"after":10}]),
        json!([{"field":"password","before":"x","after":"y"}]),
        json!([{"field":"debit","before":"0","after":"10"},{"field":"debit","before":"10","after":"20"}]),
        json!([{"field":"debit","before":"0","after":"10","actor":"forged"}]),
        json!([{"field":"debit","after":"10"}]),
        json!([{"field":"debit","before":"10","after":"10"}]),
        json!([]),
    ] {
        let row = evidence(1, changes);
        assert!(project_entry(&row, 42, 7, 9, &fields).is_err());
    }
}

#[test]
fn cursor_is_bound_to_org_company_record_actor_and_has_a_bounded_limit() {
    let q = request(None, 10);
    let cursor = q.cursor(42, ACTOR, 9, 128);
    assert_eq!(
        request(Some(cursor.clone()), 10)
            .after(42, ACTOR, 9)
            .unwrap(),
        128
    );
    for (org, actor, record) in [(43, ACTOR, 9), (42, "cd", 9), (42, ACTOR, 10)] {
        assert!(request(Some(cursor.clone()), 10)
            .after(org, actor, record)
            .is_err());
    }
    let mut different = q;
    different.company_id = 8;
    different.cursor = Some(cursor);
    assert!(different.after(42, ACTOR, 9).is_err());
    assert!(request(None, 0).validate(9).is_err());
    assert!(request(None, 51).validate(9).is_err());
    assert!(request(None, 10).validate(0).is_err());
    assert!(
        serde_json::from_value::<HistoryQuery>(json!({"companyId":7,"organizationId":43})).is_err()
    );
}

struct Fixture {
    events: Vec<Value>,
    fields: Option<Vec<String>>,
    source_exists: bool,
    line_exists: bool,
    revoke_after_read: bool,
    evidence_read: AtomicBool,
    revoke_on_line: AtomicBool,
    line_read: AtomicBool,
    requests: Mutex<Vec<(String, String)>>,
}

struct Server {
    owner: StdbClient,
    actor: StdbClient,
    fixture: Arc<Fixture>,
    handle: tokio::task::JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

fn sats_reply(sql: &str, rows: Vec<Value>) -> String {
    let (selection, from) = sql
        .strip_prefix("SELECT ")
        .unwrap()
        .split_once(" FROM ")
        .unwrap();
    let table = from.split_whitespace().next().unwrap();
    let columns = if selection == "*" {
        rows.first()
            .and_then(Value::as_object)
            .map(|row| row.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default()
    } else {
        selection.split(", ").map(str::to_owned).collect()
    };
    let fields=columns.iter().map(|column| {
        let mut field=json!({"name":{"some":column}});
        if table=="business_change" && column=="actor_identity" {
            field["algebraic_type"]=json!({"Product":{"elements":[{"name":{"some":"__identity__"},"algebraic_type":{"U256":[]}}]}});
        }
        if table=="business_change" && column=="occurred_at" {
            field["algebraic_type"]=json!({"Product":{"elements":[{"name":{"some":"__timestamp_micros_since_unix_epoch__"},"algebraic_type":{"I64":[]}}]}});
        }
        field
    }).collect::<Vec<_>>();
    let wire_rows = rows
        .iter()
        .map(|row| {
            columns
                .iter()
                .map(|column| {
                    let value = row[column].clone();
                    if table == "business_change" && column == "actor_identity" {
                        json!([format!("0x{}", value.as_str().unwrap())])
                    } else if table == "business_change" && column == "occurred_at" {
                        json!([value])
                    } else {
                        value
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    json!([{"schema":{"elements":fields},"rows":wire_rows}]).to_string()
}

fn bound(sql: &str, prefix: &str) -> Option<u64> {
    sql.split_once(prefix)?
        .1
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

async fn server(
    events: Vec<Value>,
    fields: Option<&[&str]>,
    source_exists: bool,
    line_exists: bool,
    revoke_after_read: bool,
) -> Server {
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
        let rows=match table {
            "user_profile"=>vec![json!({"id":1,"organization_id":42,"is_active":true,"is_superuser":false,"name":"Reader","metadata":null})],
            "user_organization"=>vec![json!({"id":1,"organization_id":42,"company_id":7,"role_id":2,"is_active":true})],
            "role"=>vec![json!({"id":2,"organization_id":42,"is_active":true,"name":"Reader","permissions":if (fixture.revoke_after_read&&fixture.evidence_read.load(Ordering::SeqCst)) || (fixture.revoke_on_line.load(Ordering::SeqCst)&&fixture.line_read.load(Ordering::SeqCst)) { vec!["account_move:read","account_move_line:read"] } else { GRANTS.to_vec() }})],
            "user_role_assignment"|"org_permission"=>vec![],
            "field_permission"=>fixture.fields.as_ref().map(|fields|vec![json!({"id":1,"organization_id":42,"role_id":2,"resource":"account-move-lines","action":"read","allowed_fields":fields})]).unwrap_or_default(),
            "account_move"=>{
                assert_eq!(token,"Bearer actor-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7 AND id = 9"));
                if fixture.source_exists {vec![json!({"id":9,"organization_id":42,"company_id":7,"name":"Invoice"})]} else {vec![]}
            },
            "account_move_line"=>{
                fixture.line_read.store(true,Ordering::SeqCst);
                assert_eq!(token,"Bearer actor-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7 AND move_id = 9 AND id = 10"));
                if fixture.line_exists {vec![json!({"id":10,"organization_id":42,"company_id":7,"move_id":9})]} else {vec![]}
            },
            "business_change"=>{
                assert_eq!(token,"Bearer owner-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7 AND resource = 'account_move' AND record_id = 9"));
                assert!(!sql.contains("audit_log"));
                fixture.evidence_read.store(true,Ordering::SeqCst);
                let after=bound(&sql," AND id > ").unwrap();
                let end=bound(&sql," AND id <= ").unwrap_or(u64::MAX);
                let mut rows=fixture.events.iter().rev().filter(|row| {
                    let id=row["id"].as_u64().unwrap(); id>after&&id<=end
                }).cloned().collect::<Vec<_>>();
                if sql.ends_with("LIMIT 1") { rows.truncate(1); }
                rows
            },
            other=>panic!("unexpected history fixture table {other}: {sql}"),
        };
        sats_reply(&sql, rows)
    }
    let fixture = Arc::new(Fixture {
        events,
        fields: fields.map(|fields| fields.iter().map(|field| (*field).into()).collect()),
        source_exists,
        line_exists,
        revoke_after_read,
        evidence_read: AtomicBool::new(false),
        revoke_on_line: AtomicBool::new(false),
        line_read: AtomicBool::new(false),
        requests: Mutex::new(Vec::new()),
    });
    let router = Router::new()
        .route("/v1/database/test/sql", post(respond))
        .with_state(fixture.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
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
        handle,
    }
}

fn context(server: &Server, access: FieldAccessContext) -> TrustedOperationContext {
    let session = ApiSession {
        stdb_token: "actor-token".into(),
        identity_hex: ACTOR.into(),
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

#[tokio::test]
async fn exact_record_history_uses_current_fields_and_native_sats_without_precision_loss() {
    let row = evidence(
        1,
        json!([
            {"field":"debit","before":"0","after":"9007199254740993.20"},
            {"field":"name","before":"private","after":"secret"},
            {"field":"metadata","before":null,"after":"private raw data"}
        ]),
    );
    let server = server(vec![row], Some(&["debit"]), true, true, false).await;
    let context = context(&server, access(GRANTS, Some(&["debit"])));
    let page = read_account_move_history(&server.owner, &context, 9, &request(None, 10))
        .await
        .unwrap();
    let json = serde_json::to_value(&page).unwrap();
    assert_eq!(
        json["data"][0]["changes"],
        json!([{"field":"debit","before":"0","after":"9007199254740993.20"}])
    );
    assert_eq!(json["data"][0]["actorIdentity"], ACTOR);
    assert_eq!(json["coverage"]["status"], "partial");
    assert!(!json.to_string().contains("secret"));
    assert!(!json["data"].to_string().contains("metadata"));
    assert!(page.next_cursor.is_none());
}

#[tokio::test]
async fn unprivileged_or_foreign_company_requests_never_read_private_history() {
    let server = server(vec![], None, true, true, false).await;
    let no_history = context(
        &server,
        access(&["account_move:read", "account_move_line:read"], None),
    );
    assert!(matches!(
        read_account_move_history(&server.owner, &no_history, 9, &request(None, 10)).await,
        Err(ApiError::Forbidden(_))
    ));
    assert!(server.fixture.requests.lock().unwrap().is_empty());
    let valid = context(&server, access(GRANTS, None));
    let mut query = request(None, 10);
    query.company_id = 8;
    assert!(matches!(
        read_account_move_history(&server.owner, &valid, 9, &query).await,
        Err(ApiError::Forbidden(_))
    ));
    assert!(!server.fixture.evidence_read.load(Ordering::SeqCst));
}

#[tokio::test]
async fn missing_source_prevents_history_reads_and_deleted_children_are_excluded() {
    let row = evidence(1, json!([{"field":"debit","before":"0","after":"10"}]));
    let missing = server(vec![row.clone()], None, false, true, false).await;
    let valid = context(&missing, access(GRANTS, None));
    assert!(matches!(
        read_account_move_history(&missing.owner, &valid, 9, &request(None, 10)).await,
        Err(ApiError::NotFound(_))
    ));
    assert!(!missing.fixture.evidence_read.load(Ordering::SeqCst));
    let deleted = server(vec![row], None, true, false, false).await;
    let valid = context(&deleted, access(GRANTS, None));
    let page = read_account_move_history(&deleted.owner, &valid, 9, &request(None, 10))
        .await
        .unwrap();
    assert!(page.data.is_empty());
    assert_eq!(page.coverage.status, "partial");
}

#[tokio::test]
async fn revoked_history_authority_during_read_returns_no_prior_values() {
    let server = server(
        vec![evidence(
            1,
            json!([{"field":"debit","before":"0","after":"10"}]),
        )],
        None,
        true,
        true,
        true,
    )
    .await;
    let valid = context(&server, access(GRANTS, None));
    assert!(matches!(
        read_account_move_history(&server.owner, &valid, 9, &request(None, 10)).await,
        Err(ApiError::Forbidden(_))
    ));
}

#[tokio::test]
async fn revocation_during_child_read_is_checked_before_returning_values() {
    let server = server(
        vec![evidence(
            1,
            json!([{"field":"debit","before":"0","after":"10"}]),
        )],
        None,
        true,
        true,
        false,
    )
    .await;
    server.fixture.revoke_on_line.store(true, Ordering::SeqCst);
    let valid = context(&server, access(GRANTS, None));
    assert!(matches!(
        read_account_move_history(&server.owner, &valid, 9, &request(None, 10)).await,
        Err(ApiError::Forbidden(_))
    ));
    assert!(server.fixture.line_read.load(Ordering::SeqCst));
}

#[tokio::test]
async fn sparse_unordered_windows_page_without_duplicates_or_skipped_rows() {
    let rows = [1, 130, 10_000, 1_000_000_000]
        .into_iter()
        .map(|id| evidence(id, json!([{"field":"debit","before":"0","after":"10"}])))
        .collect();
    let server = server(rows, None, true, true, false).await;
    let valid = context(&server, access(GRANTS, None));
    let mut cursor = None;
    let mut ids = Vec::new();
    for _ in 0..12 {
        let page = read_account_move_history(&server.owner, &valid, 9, &request(cursor, 1))
            .await
            .unwrap();
        ids.extend(page.data.into_iter().map(|entry| entry.id));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids, ["1", "130", "10000", "1000000000"]);
    assert!(cursor.is_none());
    assert!(server.fixture.requests.lock().unwrap().len() < 400);
}

#[tokio::test]
async fn hidden_only_pages_keep_scan_cursor_until_later_visible_history() {
    let mut rows = (1..=600)
        .map(|id| {
            evidence(
                id,
                json!([{"field":"metadata","before":null,"after":"private"}]),
            )
        })
        .collect::<Vec<_>>();
    rows.push(evidence(
        601,
        json!([{"field":"debit","before":"0","after":"10"}]),
    ));
    let server = server(rows, Some(&["debit"]), true, true, false).await;
    let valid = context(&server, access(GRANTS, Some(&["debit"])));
    let first = read_account_move_history(&server.owner, &valid, 9, &request(None, 10))
        .await
        .unwrap();
    assert!(first.data.is_empty());
    assert!(first.next_cursor.is_some());
    let second =
        read_account_move_history(&server.owner, &valid, 9, &request(first.next_cursor, 10))
            .await
            .unwrap();
    assert_eq!(
        second
            .data
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        ["601"]
    );
    assert!(second.next_cursor.is_none());
}
