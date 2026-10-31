use super::*;
use serde_json::json;

struct Fixture {
    profiles: Vec<Value>,
    memberships: Vec<Value>,
    roles: Vec<Value>,
    assignments: Vec<Value>,
    grants: Vec<Value>,
    fields: Vec<Value>,
    companies: Vec<Value>,
}
impl Fixture {
    fn new() -> Self {
        let actor = "a".repeat(64);
        Self {
            profiles: vec![
                json!({"organizationId":1,"identity":actor,"isActive":true,"isSuperuser":false,"metadata":null}),
            ],
            memberships: vec![
                json!({"organizationId":1,"userIdentity":actor,"companyId":10,"roleId":2,"isActive":true}),
            ],
            roles: vec![
                json!({"id":2,"organizationId":1,"permissions":["knowledge_article:read"],"isActive":true}),
            ],
            assignments: vec![],
            grants: vec![],
            fields: vec![],
            companies: vec![
                json!({"id":10,"organizationId":1,"isParent":true,"deletedAt":null}),
                json!({"id":11,"organizationId":1,"isParent":false,"deletedAt":null}),
            ],
        }
    }
    fn source(&self) -> Sources<'_> {
        Sources {
            profiles: &self.profiles,
            memberships: &self.memberships,
            roles: &self.roles,
            assignments: &self.assignments,
            grants: &self.grants,
            fields: &self.fields,
            companies: &self.companies,
        }
    }
}
fn viewer() -> Viewer {
    Viewer {
        organization_id: 1,
        company_id: 10,
        actor_identity: ActorIdentity::parse(&"a".repeat(64)),
    }
}

#[test]
fn current_role_denial_and_body_field_policy_control_source_read() {
    let mut f = Fixture::new();
    assert!(evaluate(f.source(), viewer(), 100));
    f.roles[0]["permissions"] = json!([]);
    assert!(!evaluate(f.source(), viewer(), 100));
    f.roles[0]["permissions"] = json!(["knowledge_article:read"]);
    f.fields.push(json!({"id":1,"organizationId":1,"subject":{"tag":"Role","value":2},"resource":"knowledge_article","action":{"tag":"Read"},"allowedFields":["name"]}));
    assert!(!evaluate(f.source(), viewer(), 100));
    f.fields[0]["allowedFields"] = json!(["name", "body"]);
    assert!(evaluate(f.source(), viewer(), 100));
    f.grants.push(json!({"organizationId":1,"subject":{"tag":"User","value":"a".repeat(64)},"resource":"knowledge_article","action":{"tag":"Read"},"effect":{"tag":"Deny"}}));
    assert!(!evaluate(f.source(), viewer(), 100));
}

#[test]
fn additive_roles_are_current_and_expiry_or_inactivation_removes_read_authority() {
    let mut f = Fixture::new();
    f.roles[0]["permissions"] = json!([]);
    f.roles.push(
        json!({"id":3,"organizationId":1,"permissions":["knowledge_article:read"],"isActive":true}),
    );
    f.assignments.push(json!({"organizationId":1,"userIdentity":"a".repeat(64),"roleId":3,"isActive":true,"expiresAt":{"microsSinceUnixEpoch":200}}));
    assert!(evaluate(f.source(), viewer(), 100));
    assert!(!evaluate(f.source(), viewer(), 200));
    f.assignments[0]["expiresAt"] = json!("malformed");
    assert!(!evaluate(f.source(), viewer(), 100));
    f.assignments[0]["expiresAt"] = Value::Null;
    f.roles[1]["isActive"] = json!(false);
    assert!(!evaluate(f.source(), viewer(), 100));
}

#[test]
fn company_scope_matches_bound_default_and_exact_global_role_rules() {
    let mut f = Fixture::new();
    let other = Viewer {
        company_id: 11,
        ..viewer()
    };
    assert!(!evaluate(f.source(), other, 100));
    f.profiles[0]["isSuperuser"] = json!(true);
    assert!(!evaluate(f.source(), other, 100));
    f.roles[0]["permissions"] = json!(["*:*"]);
    assert!(evaluate(f.source(), other, 100));
    f.profiles[0]["isSuperuser"] = json!(false);
    f.roles[0]["permissions"] = json!(["knowledge_article:read"]);
    f.memberships[0]["companyId"] = Value::Null;
    assert!(evaluate(f.source(), viewer(), 100));
    assert!(!evaluate(f.source(), other, 100));
    f.memberships.push(f.memberships[0].clone());
    assert!(!evaluate(f.source(), viewer(), 100));
}

#[test]
fn missing_inactive_or_expired_bootstrap_actor_profiles_cannot_authorize() {
    let mut f = Fixture::new();
    f.profiles[0]["metadata"] = json!("lumiere-platform-bootstrap-v1:1:101");
    assert!(evaluate(f.source(), viewer(), 100));
    assert!(!evaluate(f.source(), viewer(), 101));
    f.profiles[0]["isActive"] = json!(false);
    assert!(!evaluate(f.source(), viewer(), 100));
    f.profiles.clear();
    assert!(!evaluate(f.source(), viewer(), 100));
}

fn sql_response(rows: &[Value]) -> Value {
    let Some(first) = rows.first().and_then(Value::as_object) else {
        return json!([{"schema":{"elements":[]},"rows":[]}]);
    };
    let keys = first.keys().collect::<Vec<_>>();
    let elements = keys
        .iter()
        .map(|key| {
            let kind = match &first[*key] {
                Value::Bool(_) => json!({"Bool":[]}),
                Value::Number(_) => json!({"U64":[]}),
                Value::Array(_) => json!({"Array":{"String":[]}}),
                _ => json!({"String":[]}),
            };
            json!({"name":{"some":key},"algebraic_type":kind})
        })
        .collect::<Vec<_>>();
    json!([{"schema":{"elements":elements},"rows":rows.iter().map(|row|keys.iter().map(|key|row[*key].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()}])
}

#[tokio::test]
async fn actual_gateway_source_reader_uses_current_sql_authority_and_fails_closed_on_read_errors() {
    use axum::{http::StatusCode, routing::post, Json, Router};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };
    let fixture = Arc::new(Mutex::new(Fixture::new()));
    let rows = fixture.clone();
    let failed = Arc::new(AtomicBool::new(false));
    let fail = failed.clone();
    let queries = Arc::new(Mutex::new(Vec::new()));
    let recorded = queries.clone();
    let app = Router::new().route(
        "/v1/database/guide-policy/sql",
        post(move |sql: String| {
            let rows = rows.clone();
            let fail = fail.clone();
            let recorded = recorded.clone();
            async move {
                recorded.lock().unwrap().push(sql.clone());
                if fail.load(Ordering::SeqCst) {
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        Json(json!({"error":"unavailable"})),
                    );
                }
                let fixture = rows.lock().unwrap();
                let rows = if sql.contains("FROM knowledge_guide_actor_profile_read ") {
                    &fixture.profiles
                } else if sql.contains("FROM user_organization ") {
                    &fixture.memberships
                } else if sql.contains("FROM user_role_assignment ") {
                    &fixture.assignments
                } else if sql.contains("FROM role ") {
                    &fixture.roles
                } else if sql.contains("FROM org_permission ") {
                    &fixture.grants
                } else if sql.contains("FROM field_permission ") {
                    &fixture.fields
                } else if sql.contains("FROM company ") {
                    &fixture.companies
                } else {
                    panic!("unexpected source query")
                };
                (StatusCode::OK, Json(sql_response(rows)))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = StdbClient::new(
        format!("http://{address}"),
        "guide-policy".into(),
        "reader".into(),
    );
    assert!(allowed(&client, viewer()).await.unwrap());
    fixture.lock().unwrap().roles[0]["permissions"] = json!([]);
    assert!(!allowed(&client, viewer()).await.unwrap());
    failed.store(true, Ordering::SeqCst);
    assert!(allowed(&client, viewer()).await.is_err());
    let queries = queries.lock().unwrap();
    assert!(queries
        .iter()
        .all(|sql| sql.contains("organization_id = 1")));
    assert!(!queries.iter().any(|sql| sql.contains("FROM user_profile ")));
    server.abort();
}
