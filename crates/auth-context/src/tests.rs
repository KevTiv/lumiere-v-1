use super::*;
use axum::{extract::Query, response::IntoResponse, routing::get, Router};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

fn actor() -> ActorContext {
    ActorContext::new(&"a".repeat(64), "provider-token", 7, 9).expect("actor")
}

fn envelope() -> Value {
    json!({
        "organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64),
        "grants": [{"capabilityKey": "ai.read", "maxRows": 20, "maxBytes": 1000}]
    })
}

#[test]
fn transport_roundtrip_keeps_actor_scope_and_redacts_credentials() {
    let actor = actor();
    assert_eq!(
        ActorContext::from_headers(&actor.headers().unwrap()).unwrap(),
        actor
    );
    assert!(!format!("{actor:?}").contains("provider-token"));
    assert!(actor.require_company(10).is_err());
}

#[test]
fn malformed_missing_and_duplicate_headers_fail_closed() {
    for name in [
        ACTOR_IDENTITY_HEADER,
        ACTOR_TOKEN_HEADER,
        ORGANIZATION_HEADER,
        COMPANY_HEADER,
    ] {
        let mut headers = actor().headers().unwrap();
        headers.remove(name);
        assert!(ActorContext::from_headers(&headers).is_err());
        let mut headers = actor().headers().unwrap();
        headers.append(name, HeaderValue::from_static("forged"));
        assert!(ActorContext::from_headers(&headers).is_err());
    }
    for identity in ["unknown", "user_workos", "0x1234", ""] {
        assert!(ActorContext::new(identity, "provider-token", 7, 9).is_err());
    }
    for (token, org, company) in [
        ("", 7, 9),
        ("token\nforged", 7, 9),
        ("token", 0, 9),
        ("token", 7, 0),
    ] {
        assert!(ActorContext::new(&"a".repeat(64), token, org, company).is_err());
    }
}

#[test]
fn exact_capabilities_and_duplicate_limits_cannot_widen_authority() {
    let mut value = envelope();
    value["grants"]
        .as_array_mut()
        .unwrap()
        .push(json!({"capabilityKey":"ai.read","maxRows":5,"maxBytes":400}));
    let envelope: CapabilityGrantEnvelope = serde_json::from_value(value).unwrap();
    assert_eq!(
        envelope.bounds_for(&actor(), "ai.read"),
        Some(CapabilityGrantBounds {
            max_rows: 5,
            max_bytes: 400
        })
    );
    assert!(!envelope.permits(&actor(), "ai.write"));
    let mut foreign = actor();
    foreign.company_id = 10;
    assert!(!envelope.permits(&foreign, "ai.read"));
}

#[tokio::test]
async fn authority_is_requeried_and_denial_outage_and_scope_changes_fail_closed() {
    let reply = Arc::new(Mutex::new((http::StatusCode::OK, envelope().to_string())));
    let response = reply.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let app = Router::new().route(
            "/v1/ai/capability-grants",
            get(
                move |headers: HeaderMap, Query(query): Query<HashMap<String, String>>| {
                    let response = response.clone();
                    async move {
                        assert_eq!(headers["authorization"], "Bearer provider-token");
                        assert_eq!(headers["x-stdb-identity"], "a".repeat(64));
                        assert_eq!(query.get("companyId").map(String::as_str), Some("9"));
                        let (status, body) = response.lock().unwrap().clone();
                        (status, body).into_response()
                    }
                },
            ),
        );
        axum::serve(listener, app).await.unwrap();
    });
    let http = reqwest::Client::new();
    let timeout = Duration::from_secs(2);
    let grants = fetch_capability_grants(&http, &url, &actor(), timeout)
        .await
        .unwrap();
    assert!(grants.permits(&actor(), "ai.read"));

    let mut revoked = envelope();
    revoked["grants"] = json!([]);
    *reply.lock().unwrap() = (http::StatusCode::OK, revoked.to_string());
    assert!(!fetch_capability_grants(&http, &url, &actor(), timeout)
        .await
        .unwrap()
        .permits(&actor(), "ai.read"));

    for (field, value) in [
        ("organizationId", json!(8)),
        ("companyId", json!(10)),
        ("actorIdentity", json!("b".repeat(64))),
    ] {
        let mut foreign = envelope();
        foreign[field] = value;
        *reply.lock().unwrap() = (http::StatusCode::OK, foreign.to_string());
        assert!(matches!(
            fetch_capability_grants(&http, &url, &actor(), timeout).await,
            Err(AuthorityError::Denied)
        ));
    }
    for status in [http::StatusCode::UNAUTHORIZED, http::StatusCode::FORBIDDEN] {
        *reply.lock().unwrap() = (status, envelope().to_string());
        assert!(matches!(
            fetch_capability_grants(&http, &url, &actor(), timeout).await,
            Err(AuthorityError::Denied)
        ));
    }
    *reply.lock().unwrap() = (
        http::StatusCode::SERVICE_UNAVAILABLE,
        envelope().to_string(),
    );
    assert!(matches!(
        fetch_capability_grants(&http, &url, &actor(), timeout).await,
        Err(AuthorityError::Unavailable)
    ));
    *reply.lock().unwrap() = (http::StatusCode::OK, "malformed".into());
    assert!(matches!(
        fetch_capability_grants(&http, &url, &actor(), timeout).await,
        Err(AuthorityError::Unavailable)
    ));
    server.abort();
    assert!(fetch_capability_grants(&http, &url, &actor(), timeout)
        .await
        .is_err());
}
