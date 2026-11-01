use super::*;
use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use serde_json::Value;
use std::sync::Mutex;

const ADMIN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WORKER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const SERVICE: &str = "expense_integration_worker";

#[derive(Default)]
struct Database {
    organizations: BTreeMap<u64, bool>,
    bindings: Vec<Value>,
    writes: Vec<Value>,
    processed: Vec<Value>,
    fail_organization: Option<u64>,
}

struct Fixture {
    database: Arc<Mutex<Database>>,
    client: StdbClient,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

fn binding(organization_id: u64, identity: &str, active: bool) -> Value {
    json!({"organization_id": organization_id, "service_name": SERVICE,
        "identity": identity, "is_active": active})
}

fn sats(rows: Vec<Value>) -> Value {
    let columns: Vec<_> = rows
        .first()
        .and_then(Value::as_object)
        .map(|row| row.keys().cloned().collect())
        .unwrap_or_default();
    json!([{"schema": {"elements": columns.iter().map(|name| json!({"name":{"some":name}})).collect::<Vec<_>>()},
        "rows": rows.iter().map(|row| columns.iter().map(|column| row[column].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()}])
}

async fn sql(
    State(database): State<Arc<Mutex<Database>>>,
    headers: HeaderMap,
    sql: String,
) -> (HeaderMap, Json<Value>) {
    let worker = headers.get("authorization").unwrap() == "Bearer worker-token";
    let db = database.lock().unwrap();
    let rows = if sql.contains("FROM cold_tier_service_identity") {
        db.bindings
            .iter()
            .filter(|row| {
                if sql.contains("AS binding") {
                    row["identity"] == WORKER
                        && row["is_active"] == true
                        && db
                            .organizations
                            .get(&row["organization_id"].as_u64().unwrap())
                            == Some(&true)
                } else if sql.contains("AND service_name") {
                    let id = sql
                        .split("organization_id = ")
                        .nth(1)
                        .unwrap()
                        .split_whitespace()
                        .next()
                        .unwrap()
                        .parse::<u64>()
                        .unwrap();
                    row["organization_id"] == id && row["is_active"] == true
                } else {
                    true
                }
            })
            .cloned()
            .collect()
    } else {
        db.organizations
            .iter()
            .filter(|(_, active)| !sql.contains("is_active = true") || **active)
            .map(|(id, _)| json!({"id":id}))
            .collect()
    };
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        "spacetime-identity",
        if worker { WORKER } else { ADMIN }.parse().unwrap(),
    );
    (response_headers, Json(sats(rows)))
}

async fn register(
    State(database): State<Arc<Mutex<Database>>>,
    headers: HeaderMap,
    Json(args): Json<Value>,
) -> axum::http::StatusCode {
    assert_eq!(headers.get("authorization").unwrap(), "Bearer admin-token");
    let mut db = database.lock().unwrap();
    let id = args[0].as_u64().unwrap();
    if db.fail_organization == Some(id) {
        return axum::http::StatusCode::SERVICE_UNAVAILABLE;
    }
    assert_eq!(args[1], format!("tenant-enrollment-{SERVICE}-{id}"));
    db.writes.push(args.clone());
    let identity = args[3]
        .as_str()
        .or_else(|| args[3]["__identity__"].as_str())
        .unwrap()
        .trim_start_matches("0x");
    db.bindings.push(binding(id, identity, true));
    axum::http::StatusCode::OK
}

async fn process(
    State(database): State<Arc<Mutex<Database>>>,
    headers: HeaderMap,
    Json(args): Json<Value>,
) -> axum::http::StatusCode {
    assert_eq!(headers.get("authorization").unwrap(), "Bearer worker-token");
    let mut db = database.lock().unwrap();
    assert!(db
        .bindings
        .iter()
        .any(|binding| binding["organization_id"] == args[0]
            && binding["identity"] == WORKER
            && binding["is_active"] == true));
    db.processed.push(args);
    axum::http::StatusCode::OK
}

impl Fixture {
    async fn new() -> Self {
        crate::install_rustls_crypto_provider();
        let database = Arc::new(Mutex::new(Database {
            organizations: BTreeMap::from([(101, true), (202, true), (303, false)]),
            ..Default::default()
        }));
        let app = Router::new()
            .route("/v1/database/test/sql", post(sql))
            .route(
                "/v1/database/test/call/register_cold_tier_service_identity",
                post(register),
            )
            .route(
                "/v1/database/test/call/apply_pending_expense_integration_intents",
                post(process),
            )
            .with_state(database.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = StdbClient::new(
            format!("http://{}", listener.local_addr().unwrap()),
            "test".into(),
            "admin-token".into(),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            database,
            client,
            server,
        }
    }
}

fn services() -> TenantServices {
    TenantServices::parse(&json!({SERVICE: WORKER}).to_string()).unwrap()
}

#[tokio::test]
async fn existing_and_new_tenants_enroll_without_restarting_worker_or_rotating_credentials() {
    let fixture = Fixture::new().await;
    let worker = fixture.client.with_token("worker-token");
    assert!(
        crate::service_identity::discover_service_organizations(&worker, SERVICE, None)
            .await
            .unwrap()
            .is_empty()
    );
    reconcile(&fixture.client, &services(), |_| true)
        .await
        .unwrap();
    assert_eq!(
        crate::service_identity::discover_service_organizations(&worker, SERVICE, None)
            .await
            .unwrap(),
        vec![101, 202]
    );
    fixture
        .database
        .lock()
        .unwrap()
        .organizations
        .insert(404, true);
    reconcile(&fixture.client, &services(), |_| true)
        .await
        .unwrap();
    assert_eq!(
        crate::service_identity::discover_service_organizations(&worker, SERVICE, None)
            .await
            .unwrap(),
        vec![101, 202, 404]
    );
    reconcile(&fixture.client, &services(), |_| true)
        .await
        .unwrap();
    assert_eq!(fixture.database.lock().unwrap().writes.len(), 3);
    let mut config = crate::session::test_support::test_config(Some("admin-token"));
    config.stdb_host = fixture.client.base_url().into();
    config.stdb_module = "test".into();
    let mut state = AppState::new(config);
    state.stdb = worker;
    let service = crate::integration_worker::ScheduledService::authorize(&state, 404, SERVICE)
        .await
        .unwrap();
    service
        .call(
            "apply_pending_expense_integration_intents",
            json!([404, 20]),
        )
        .await
        .unwrap();
    assert!(service
        .call(
            "apply_pending_expense_integration_intents",
            json!([101, 20])
        )
        .await
        .is_err());
    assert_eq!(
        fixture.database.lock().unwrap().processed,
        vec![json!([404, 20])]
    );
}

#[tokio::test]
async fn retired_conflicting_inactive_and_fenced_tenants_are_not_rebound() {
    let fixture = Fixture::new().await;
    {
        let mut db = fixture.database.lock().unwrap();
        db.bindings
            .extend([binding(101, WORKER, false), binding(202, OTHER, true)]);
        db.organizations.insert(404, true);
    }
    assert!(reconcile(&fixture.client, &services(), |id| id != 404)
        .await
        .is_err());
    assert!(fixture.database.lock().unwrap().writes.is_empty());
    assert!(crate::service_identity::discover_service_organizations(
        &fixture.client.with_token("worker-token"),
        SERVICE,
        None
    )
    .await
    .unwrap()
    .is_empty());
}

#[tokio::test]
async fn one_failed_tenant_does_not_block_other_tenants_and_is_retried() {
    let fixture = Fixture::new().await;
    fixture.database.lock().unwrap().fail_organization = Some(101);
    assert!(reconcile(&fixture.client, &services(), |_| true)
        .await
        .is_err());
    assert_eq!(fixture.database.lock().unwrap().writes.len(), 1);
    fixture.database.lock().unwrap().fail_organization = None;
    reconcile(&fixture.client, &services(), |_| true)
        .await
        .unwrap();
    assert_eq!(fixture.database.lock().unwrap().writes.len(), 2);
}

#[tokio::test]
async fn tenant_restrictions_cannot_select_another_identity_or_inactive_tenant() {
    let fixture = Fixture::new().await;
    fixture.database.lock().unwrap().bindings.extend([
        binding(101, WORKER, true),
        binding(202, OTHER, true),
        binding(303, WORKER, true),
    ]);
    let worker = fixture.client.with_token("worker-token");
    assert_eq!(
        crate::service_identity::discover_service_organizations(&worker, SERVICE, None)
            .await
            .unwrap(),
        vec![101]
    );
    for id in [202, 303] {
        assert!(crate::service_identity::discover_service_organizations(
            &worker,
            SERVICE,
            Some(&[id].into())
        )
        .await
        .is_err());
    }
}

#[tokio::test]
async fn administrator_identity_cannot_be_enrolled_as_a_worker() {
    let fixture = Fixture::new().await;
    let config = TenantServices::parse(&json!({SERVICE: ADMIN}).to_string()).unwrap();
    assert!(reconcile(&fixture.client, &config, |_| true).await.is_err());
    assert!(fixture.database.lock().unwrap().writes.is_empty());
}

#[test]
fn enrollment_only_accepts_known_services_and_distinct_nonzero_public_identities() {
    for value in [
        json!({}),
        json!({SERVICE: "token-not-identity"}),
        json!({SERVICE: "0".repeat(64)}),
        json!({"arbitrary_service": WORKER}),
        json!({SERVICE: WORKER, "hr_integration_worker": WORKER}),
    ] {
        assert!(TenantServices::parse(&value.to_string()).is_err());
    }
    assert!(TenantServices::parse(
        &json!({"projection_worker":WORKER,"pos_order_hydrator":WORKER}).to_string()
    )
    .is_ok());
}

#[test]
fn explicit_tenant_lists_fail_closed_instead_of_silently_dropping_bad_entries() {
    use crate::service_identity::parse_organization_selection as parse;
    assert!(parse(None).unwrap().is_none());
    assert!(parse(Some(" ")).unwrap().is_none());
    assert_eq!(
        parse(Some("202,101,202")).unwrap().unwrap(),
        [101, 202].into()
    );
    for value in ["0", "101,bad", "101,", "-1", "18446744073709551616"] {
        assert!(parse(Some(value)).is_err(), "{value}");
    }
}
