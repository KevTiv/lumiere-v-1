use super::*;
const ACTOR: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[tokio::test]
async fn flattened_save_uses_actual_generated_contract_and_sats_http_wire() {
    use std::sync::{Arc, Mutex};
    let captured = Arc::new(Mutex::new(Vec::<Value>::new()));
    async fn capture(
        State(captured): State<Arc<Mutex<Vec<Value>>>>,
        headers: axum::http::HeaderMap,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        captured.lock().unwrap().push(json!({
            "authorization":headers.get(axum::http::header::AUTHORIZATION).unwrap().to_str().unwrap(),
            "body":body
        }));
        Json(json!({}))
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new()
        .route(
            "/v1/database/guide-wire-test/call/save_knowledge_guide",
            axum::routing::post(capture),
        )
        .with_state(captured.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let body: SaveRequest = serde_json::from_value(json!({
        "companyId":"9007199254740995", "guideId":"9007199254740993", "expectedRevision":2,
        "requestKey":"save-attempt-1", "draftKey":"same-conversation-draft", "title":"Bill guide",
        "module":"accounting", "markdown":"# Record-grounded guide", "html":"<h1>Guide</h1>",
        "language":"en", "originMessageId":"message-7", "sources":[]
    }))
    .unwrap();
    let call = stdb_client::ReducerCall::from_name(
        "save_knowledge_guide",
        save_arguments(11, 9_007_199_254_740_995, &body).unwrap(),
    )
    .unwrap();
    assert_eq!(call.contract().params.len(), 16);
    assert_eq!(call.contract().organization_position, Some(0));
    assert_eq!(call.contract().company_position, Some(1));
    let names: Vec<_> = call
        .contract()
        .params
        .iter()
        .map(|parameter| parameter.name)
        .collect();
    assert_eq!(
        names,
        vec![
            "organization_id",
            "company_id",
            "guide_id",
            "expected_revision",
            "request_key",
            "draft_key",
            "title",
            "module",
            "workflow",
            "markdown",
            "html",
            "language",
            "workflow_version",
            "sources_json",
            "origin_message_id",
            "origin_run_id"
        ]
    );
    stdb_client::StdbClient::new(
        format!("http://{address}"),
        "guide-wire-test".into(),
        "actor-session-token".into(),
    )
    .call_reducer(call)
    .await
    .unwrap();
    server.abort();
    let captured = captured.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0]["authorization"], "Bearer actor-session-token");
    let fields: serde_json::Map<String, Value> = names
        .into_iter()
        .zip(captured[0]["body"].as_array().unwrap().iter())
        .map(|(name, value)| (name.to_string(), value.clone()))
        .collect();
    assert_eq!(fields["company_id"], json!(9_007_199_254_740_995u64));
    assert_eq!(fields["guide_id"], json!({"some":9_007_199_254_740_993u64}));
    assert_eq!(fields["expected_revision"], json!({"some":2}));
    assert_eq!(fields["workflow"], json!({"none":[]}));
    assert_eq!(fields["workflow_version"], json!({"none":[]}));
    assert_eq!(fields["html"], json!({"some":"<h1>Guide</h1>"}));
    assert_eq!(fields["origin_message_id"], json!({"some":"message-7"}));
    assert_eq!(fields["origin_run_id"], json!({"none":[]}));
    assert_eq!(fields["draft_key"], "same-conversation-draft");
    assert_eq!(fields["sources_json"], "[]");
}
#[test]
fn guide_payload_cannot_bypass_explicit_article_body_restriction() {
    let mut access = FieldAccessContext {
        role_id: 7,
        role_permissions: vec!["knowledge_article:read".into()],
        ..Default::default()
    };
    assert!(guide_content_allowed(&access));
    access
        .field_permissions
        .push(stdb_auth::FieldPermissionLike {
            id: None,
            organization_id: None,
            role_id: Some(7),
            resource: "knowledge_article".into(),
            action: "read".into(),
            allowed_fields: vec!["name".into()],
            subject_user_hex: None,
            subject_role_id: None,
        });
    assert!(!guide_content_allowed(&access));
    access.field_permissions[0]
        .allowed_fields
        .push("body".into());
    assert!(guide_content_allowed(&access));
}
#[test]
fn source_projection_rejects_executable_links_and_bounds_fields() {
    assert!(source_projection(&json!({"href":"javascript:alert(1)"})).is_err());
    assert!(source_projection(&json!({"url":"//other.example"})).is_err());
    assert!(source_projection(&json!({"href":"/\\other.example"})).is_err());
    assert!(source_projection(&json!({"excerpt":"a".repeat(2001)})).is_err());
    assert_eq!(
        source_projection(&json!({"href":"/accounting/42","secret":"ignored"})).unwrap(),
        json!({"href":"/accounting/42"})
    );
}
#[test]
fn member_projection_fails_closed_for_missing_or_other_actor() {
    assert!(!is_member(&json!({"create_uid":ACTOR}), ACTOR));
    assert!(is_member(&json!({"member_ids":[ACTOR]}), ACTOR));
    assert!(is_member(&json!({"memberIds":[[ACTOR]]}), ACTOR));
    assert!(!is_member(
        &json!({"member_ids":[ACTOR]}),
        "0000000000000000000000000000000000000000000000000000000000000000"
    ));
}
#[test]
fn projects_canonical_camel_case_sql_rows_and_timestamps() {
    let guide = project(&json!({"id":7,"organizationId":1,"companyId":2,"latestRevision":1,"reviewState":"draft","module":"accounting"}),
        &json!({"revision":1,"sourcesJson":"[]","contentHash":"hash","draftKey":"draft-1","originRunId":"9","createDate":{"microsSinceUnixEpoch":0}}),true).unwrap();
    assert_eq!(guide["companyId"], "2");
    assert_eq!(guide["headRevision"], 1);
    assert_eq!(guide["runId"], "9");
    assert_eq!(guide["contentHash"], "hash");
    assert!(guide["updatedAt"]
        .as_str()
        .unwrap()
        .starts_with("1970-01-01"));
}
#[test]
fn historical_revision_is_never_labelled_current_verified() {
    let guide = project(
        &json!({"id":1,"latest_revision":2,"review_state":"verified"}),
        &json!({"revision":1,"sources_json":"[]"}),
        false,
    )
    .unwrap();
    assert_eq!(guide["reviewState"], "superseded");
    assert_eq!(guide["guideId"], "1");
    assert_eq!(guide["provenance"], "user_saved");
}
