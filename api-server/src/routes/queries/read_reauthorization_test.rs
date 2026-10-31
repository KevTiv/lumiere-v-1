//! Native HTTP fixtures whose policy changes while a protected source is read.
use crate::trusted_context::{TrustedOperationContext, RESOURCE_QUERY_OPERATION_ID};
use axum::{
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

pub(super) enum Source {
    Allocations {
        parent_exists: bool,
        rows: Vec<Value>,
    },
    CreationReceipt {
        rows: Vec<Value>,
    },
}

#[derive(Clone, Copy)]
pub(super) enum Revocation {
    None,
    ResourcePermission,
    AllocationFields,
    Membership,
    Company,
    InactiveProfile,
    AuthorityUnavailable,
}

pub(super) struct Fixture {
    pub context: TrustedOperationContext,
    pub owner: StdbClient,
    pub queries: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(super) async fn fixture(source: Source, revocation: Revocation) -> Fixture {
    let allocations = matches!(&source, Source::Allocations { .. });
    let base_permissions = if allocations {
        vec!["hr_expense:read"]
    } else {
        vec!["contact:create"]
    };
    let initial_permissions: Vec<_> = base_permissions
        .iter()
        .map(|permission| (*permission).to_string())
        .collect();
    let source = Arc::new(source);
    let consumed = Arc::new(AtomicBool::new(false));
    let queries = Arc::new(Mutex::new(Vec::new()));
    let recorded = queries.clone();
    let router = Router::new().route("/v1/database/read-reauthorization/sql", post(move |headers: HeaderMap, sql: String| {
        let source = source.clone(); let consumed = consumed.clone(); let recorded = recorded.clone(); let permissions = base_permissions.clone();
        async move {
            let token = headers.get("authorization").unwrap().to_str().unwrap();
            assert!(matches!(token, "Bearer actor-token" | "Bearer owner-token"));
            recorded.lock().unwrap().push(sql.clone());
            let after = consumed.load(Ordering::SeqCst);
            if sql.contains(" FROM user_profile ") {
                assert_eq!(token, "Bearer owner-token", "fresh policy must use the authority client");
                assert!(after, "refresh belongs after the protected source await");
                if matches!(revocation, Revocation::AuthorityUnavailable) { return (StatusCode::SERVICE_UNAVAILABLE, "authority unavailable").into_response(); }
            }
            let rows = if sql.contains(" FROM user_profile ") {
                vec![json!({"id":1,"identity":{"__identity__":format!("0x{}","ab".repeat(32))},"organization_id":42,
                    "is_active":!matches!(revocation,Revocation::InactiveProfile),"is_superuser":false,"metadata":null})]
            } else if sql.contains(" FROM user_organization ") {
                if after && matches!(revocation, Revocation::Membership) { vec![] } else {
                    vec![json!({"id":1,"organization_id":42,"company_id":if after && matches!(revocation,Revocation::Company){8}else{7},"is_active":true,"role_id":1})]
                }
            } else if sql.contains(" FROM user_role_assignment ") || sql.contains(" FROM org_permission ") { vec![]
            } else if sql.contains(" FROM role ") {
                vec![json!({"id":1,"organization_id":42,"name":"Clerk","permissions":if after && matches!(revocation,Revocation::ResourcePermission){Vec::<&str>::new()}else{permissions},"is_active":true})]
            } else if sql.contains(" FROM field_permission ") {
                if after && matches!(revocation,Revocation::AllocationFields) {
                    vec![json!({"id":1,"organization_id":42,"subject":null,"role_id":1,"resource":"expense-allocations","action":"read","allowed_fields":["billable"]})]
                } else { vec![] }
            } else if sql.contains(" FROM hr_expense_allocation ") {
                assert_eq!(token, "Bearer actor-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7 AND expense_id = 9"));
                consumed.store(true, Ordering::SeqCst);
                match source.as_ref() { Source::Allocations{rows,..} => rows.clone(), _=>panic!("wrong source") }
            } else if sql.contains(" FROM hr_expense ") {
                assert_eq!(token, "Bearer actor-token");
                assert!(sql.contains("organization_id = 42 AND company_id = 7 AND id = 9"));
                match source.as_ref() { Source::Allocations{parent_exists,..} => if *parent_exists {vec![json!({"id":9,"organization_id":42,"company_id":7})]} else {vec![]}, _=>panic!("wrong source") }
            } else if sql.contains(" FROM record_creation_receipt ") {
                assert_eq!(token, "Bearer owner-token");
                assert!(sql.contains("id = '42:7:contact:attempt' AND organization_id = 42 AND company_id = 7 AND model = 'contact' AND created_by = "));
                assert!(sql.contains(&"ab".repeat(32)));
                consumed.store(true, Ordering::SeqCst);
                match source.as_ref() { Source::CreationReceipt{rows} => rows.clone(), _=>panic!("wrong source") }
            } else { panic!("Unexpected SQL: {sql}") };
            let projection = sql.strip_prefix("SELECT ").unwrap().split_once(" FROM ").unwrap().0;
            let columns: Vec<String> = if projection == "*" {
                rows.first().and_then(Value::as_object).map(|row|row.keys().cloned().collect()).unwrap_or_else(||vec!["id".into()])
            } else { projection.split(", ").map(str::to_string).collect() };
            Json(json!([{"schema":{"elements":columns.iter().map(|column|json!({"name":{"some":column}})).collect::<Vec<_>>()},
                "rows":rows.iter().map(|row|columns.iter().map(|column|row.get(column).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>()).collect::<Vec<_>>() }])).into_response()
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = StdbClient::new(
        format!("http://{address}"),
        "read-reauthorization".into(),
        "actor-token".into(),
    );
    let owner = client.with_token("owner-token");
    let context = TrustedOperationContext::from_session(
        &crate::session::ApiSession {
            stdb_token: "actor-token".into(),
            identity_hex: "ab".repeat(32),
            organization_id: Some(42),
            field_access: Some(FieldAccessContext {
                organization_id: 42,
                role_id: 1,
                identity_hex: "ab".repeat(32),
                role_permissions: initial_permissions,
                ..FieldAccessContext::default()
            }),
        },
        client,
        RESOURCE_QUERY_OPERATION_ID,
    )
    .unwrap();
    Fixture {
        context,
        owner,
        queries,
        task,
    }
}
