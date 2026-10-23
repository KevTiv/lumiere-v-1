use super::*;
use crate::realtime::subscription::{authorized_resources, validate_resources};
use stdb_auth::{ActionPermission, FieldAccessContext};

fn access() -> FieldAccessContext {
    FieldAccessContext {
        organization_id: 42,
        identity_hex: "cd".repeat(32),
        role_permissions: vec!["workflow:read".into()],
        ..FieldAccessContext::default()
    }
}

#[test]
fn private_workflow_keys_require_canonical_workflow_read_and_keep_legacy_delegates_separate() {
    let resources: Vec<String> = WORKFLOW_INVALIDATION_TABLES
        .iter()
        .map(|(key, _)| (*key).into())
        .collect();
    validate_resources(&resources).unwrap();
    let mut access = access();
    assert_eq!(
        authorized_resources(&resources, Some(&access)).unwrap(),
        resources
    );
    access.role_permissions.clear();
    assert!(authorized_resources(&resources, Some(&access))
        .unwrap()
        .is_empty());
    access.role_permissions.push("workflow:*".into());
    access.org_permissions.push(ActionPermission {
        resource: "workflow".into(),
        action: "read".into(),
        allow: false,
    });
    assert!(authorized_resources(&resources, Some(&access))
        .unwrap()
        .is_empty());
    assert!(authorized_resources(&resources, None).is_err());
    assert_eq!(
        resource_table("workflow-delegations"),
        Some("workflow_delegation")
    );
    assert_eq!(resource_table("purchase-approval-delegates"), None);
}

#[test]
fn private_workflow_queries_are_allowlisted_and_exactly_org_and_company_scoped() {
    let resources = vec![
        "workflow-human-tasks".into(),
        "workflow-candidate-group-members".into(),
        "workflow-delegations".into(),
        "workflow-human-tasks".into(),
    ];
    let queries = subscription_queries(&resources, 42, 7).unwrap();
    assert_eq!(queries.len(), 3);
    for query in queries {
        assert!(
            query.ends_with("WHERE organization_id = 42 AND company_id = 7"),
            "{query}"
        );
        assert!(!query.contains("user_profile"));
        assert!(!query.contains(" OR "));
    }
    assert!(subscription_queries(&resources, 0, 7).is_err());
    assert!(subscription_queries(&resources, 42, 0).is_err());
    for untrusted in [
        "auth",
        "user-profile",
        "workflow-human-task-receipts",
        "workflow_human_task WHERE 1=1",
        "purchase-approval-delegates",
    ] {
        assert!(subscription_queries(&[untrusted.into()], 42, 7).is_err());
    }
}

fn scoped_rows() -> (Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>) {
    (
        vec![json!({"id":42,"is_active":true})],
        vec![json!({"id":7,"organization_id":42,"deleted_at":null})],
        vec![
            json!({"identity":"cd".repeat(32),"organization_id":42,"is_active":true,"is_superuser":false}),
        ],
        vec![
            json!({"user_identity":"cd".repeat(32),"organization_id":42,"company_id":7,"is_active":true}),
        ],
    )
}

#[test]
fn workflow_scope_rejects_foreign_inactive_deleted_ambiguous_and_missing_authority() {
    let actor = "cd".repeat(32);
    let (organizations, companies, profiles, memberships) = scoped_rows();
    assert!(current_scope_matches(
        42,
        7,
        &actor,
        false,
        &organizations,
        &companies,
        &profiles,
        &memberships
    ));
    assert!(!current_scope_matches(
        42,
        8,
        &actor,
        false,
        &organizations,
        &companies,
        &profiles,
        &memberships
    ));
    assert!(!current_scope_matches(
        43,
        7,
        &actor,
        false,
        &organizations,
        &companies,
        &profiles,
        &memberships
    ));
    for (index, field, value) in [
        (0, "is_active", json!(false)),
        (1, "organization_id", json!(43)),
        (1, "deleted_at", json!(100)),
        (2, "is_active", json!(false)),
        (2, "identity", json!("ef".repeat(32))),
        (2, "is_superuser", json!(true)),
        (3, "is_active", json!(false)),
        (3, "company_id", json!(8)),
        (3, "organization_id", json!(43)),
        (3, "user_identity", json!("ef".repeat(32))),
    ] {
        let mut rows = [
            organizations.clone(),
            companies.clone(),
            profiles.clone(),
            memberships.clone(),
        ];
        rows[index][0][field] = value;
        assert!(
            !current_scope_matches(42, 7, &actor, false, &rows[0], &rows[1], &rows[2], &rows[3]),
            "{index} {field}"
        );
    }
    for index in 0..4 {
        let mut rows = [
            organizations.clone(),
            companies.clone(),
            profiles.clone(),
            memberships.clone(),
        ];
        rows[index].clear();
        assert!(!current_scope_matches(
            42, 7, &actor, false, &rows[0], &rows[1], &rows[2], &rows[3]
        ));
    }
    let duplicate = vec![memberships[0].clone(), memberships[0].clone()];
    assert!(!current_scope_matches(
        42,
        7,
        &actor,
        false,
        &organizations,
        &companies,
        &profiles,
        &duplicate
    ));
    let unrestricted = vec![
        json!({"user_identity":actor,"organization_id":42,"company_id":null,"is_active":true}),
    ];
    assert!(current_scope_matches(
        42,
        7,
        &actor,
        false,
        &organizations,
        &companies,
        &profiles,
        &unrestricted
    ));
}

#[test]
fn authority_change_forces_refetch_without_forwarding_rows_or_private_values() {
    for table in [
        "workflow_candidate_group_member",
        "workflow_delegation",
        "user_organization",
        "user_profile",
        "role",
        "org_permission",
        "field_permission",
        "company",
    ] {
        let notice = authority_refresh_notice(&json!({
            "type":"change", "op":"update", "table":table,
            "row":{"identity":"PRIVATE IDENTITY","comment":"PRIVATE COMMENT"},
            "rows":[{"guarded_action":"PRIVATE INPUT"}], "resources":["untrusted"]
        }))
        .unwrap();
        let parsed: Value = serde_json::from_str(&notice).unwrap();
        assert_eq!(parsed.as_object().unwrap().len(), 4);
        assert!(parsed["resources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|resource| resource == "auth"));
        assert!(parsed["resources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|resource| resource == "workflow-human-tasks"));
        assert!(!notice.contains("PRIVATE"));
        assert!(!notice.contains("untrusted"));
    }
    assert!(authority_refresh_notice(
        &json!({"type":"change","op":"update","table":"workflow_human_task"})
    )
    .is_none());
    assert!(
        authority_refresh_notice(&json!({"type":"subscribed","table":"user_profile"})).is_none()
    );
    assert!(authority_refresh_notice(
        &json!({"type":"change","op":"payload","table":"user_profile"})
    )
    .is_none());
    assert_eq!(
        callback_resources("workflow_human_task", &["auth".into()]),
        vec!["workflow-human-tasks"]
    );
    assert_eq!(
        callback_resources("workflow_delegation", &[]),
        vec!["workflow-delegations"]
    );
}

#[tokio::test]
async fn current_workflow_scope_uses_only_bounded_owner_lookups_and_denies_revoked_membership() {
    use crate::session::ApiSession;
    use axum::{extract::State, http::HeaderMap, routing::post, Router};
    use std::sync::{Arc, Mutex};

    struct Fixture {
        member_active: Mutex<bool>,
        calls: Mutex<usize>,
    }
    async fn respond(
        State(fixture): State<Arc<Fixture>>,
        headers: HeaderMap,
        sql: String,
    ) -> String {
        assert_eq!(headers["authorization"], "Bearer owner-token");
        assert!(sql.ends_with("LIMIT 2"));
        assert!(sql.contains(" = 42"));
        *fixture.calls.lock().unwrap() += 1;
        let (organizations, companies, profiles, mut memberships) = scoped_rows();
        memberships[0]["is_active"] = json!(*fixture.member_active.lock().unwrap());
        let (selection, tail) = sql
            .strip_prefix("SELECT ")
            .unwrap()
            .split_once(" FROM ")
            .unwrap();
        let table = tail.split_whitespace().next().unwrap();
        let rows = match table {
            "organization" => organizations,
            "company" => {
                assert!(sql.contains("organization_id = 42 AND id = 7"));
                companies
            }
            "user_profile" => {
                assert!(sql.contains(&format!("identity = 0x{}", "cd".repeat(32))));
                profiles
            }
            "user_organization" => {
                assert!(sql.contains(&format!("user_identity = 0x{}", "cd".repeat(32))));
                memberships
            }
            _ => panic!("unexpected table {table}"),
        };
        let columns: Vec<_> = selection.split(", ").collect();
        json!([{
            "schema":{"elements":columns.iter().map(|name| json!({"name":{"some":name}})).collect::<Vec<_>>()},
            "rows":rows.iter().map(|row| columns.iter().map(|name| row[*name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()
        }]).to_string()
    }
    let fixture = Arc::new(Fixture {
        member_active: Mutex::new(true),
        calls: Mutex::new(0),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new()
        .route("/v1/database/test/sql", post(respond))
        .with_state(fixture.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let owner = StdbClient::new(
        format!("http://{address}"),
        "test".into(),
        "owner-token".into(),
    );
    let actor = StdbClient::new(
        format!("http://{address}"),
        "test".into(),
        "actor-token".into(),
    );
    let session = ApiSession {
        stdb_token: "actor-token".into(),
        identity_hex: "cd".repeat(32),
        organization_id: Some(42),
        field_access: Some(access()),
    };
    let context =
        TrustedOperationContext::from_session(&session, actor.clone(), "erp.subscribe_resources")
            .unwrap();
    require_current_scope(&owner, &context, 7).await.unwrap();
    assert_eq!(*fixture.calls.lock().unwrap(), 4);
    *fixture.member_active.lock().unwrap() = false;
    assert!(matches!(
        require_current_scope(&owner, &context, 7).await,
        Err(ApiError::Forbidden(_))
    ));
    let mut reader = session;
    reader
        .field_access
        .as_mut()
        .unwrap()
        .role_permissions
        .clear();
    let denied =
        TrustedOperationContext::from_session(&reader, actor, "erp.subscribe_resources").unwrap();
    let calls = *fixture.calls.lock().unwrap();
    assert!(matches!(
        require_current_scope(&owner, &denied, 7).await,
        Err(ApiError::Forbidden(_))
    ));
    assert_eq!(*fixture.calls.lock().unwrap(), calls);
    server.abort();
}
