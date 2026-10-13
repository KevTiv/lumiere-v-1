use super::*;
use serde_json::json;
use stdb_auth::FieldPermissionLike;

const ACTOR: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const OTHER: &str = "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";
const RESOURCES: [&str; 3] = [
    "document-signature-requests",
    "document-legal-holds",
    "document-external-refs",
];

fn access(permissions: &[&str]) -> FieldAccessContext {
    FieldAccessContext {
        organization_id: 7,
        role_id: 3,
        role_name: "Document reader".into(),
        is_superuser: false,
        role_permissions: permissions.iter().map(|value| (*value).into()).collect(),
        identity_hex: ACTOR.into(),
        field_permissions: vec![],
    }
}

fn parent(id: Value) -> Value {
    json!({"id": id, "organizationId": 7, "ownerId": ACTOR, "isDeleted": false})
}

#[test]
fn document_read_grants_do_not_require_child_permissions() {
    for grant in [
        "documents:read",
        "documents:*",
        "document:read",
        "document:*",
        "doc_document:read",
        "doc_document:*",
        "module:documents:read",
        "module:documents:*",
        "*:*",
        "*:read",
    ] {
        let fa = access(&[grant]);
        assert!(has_document_read_permission(Some(&fa)), "{grant}");
        assert!(document_parent_sql(7, ACTOR, Some(&fa)).is_ok(), "{grant}");
    }
    let mut fa = access(&[]);
    fa.is_superuser = true;
    assert!(document_parent_sql(7, ACTOR, Some(&fa)).is_ok());
}

#[test]
fn absent_write_only_unrelated_and_child_only_grants_fail_closed() {
    assert!(!has_document_read_permission(None));
    for grant in [
        "documents:write",
        "document:write",
        "doc_document:write",
        "module:documents:write",
        "module:crm:read",
        "document_read",
        "document-signature-requests:read",
        "document-legal-holds:read",
        "document-external-refs:read",
    ] {
        let fa = access(&[grant]);
        assert!(!has_document_read_permission(Some(&fa)), "{grant}");
        assert!(document_parent_sql(7, ACTOR, Some(&fa)).is_err(), "{grant}");
    }
}

#[test]
fn parent_sql_matches_live_document_acl_even_for_superusers() {
    let mut fa = access(&[]);
    fa.is_superuser = true;
    let (sql, identity) = document_parent_sql(7, ACTOR, Some(&fa)).unwrap();
    assert_eq!(identity, format!("0x{ACTOR}"));
    assert_eq!(sql, format!(
        "SELECT id, organization_id, owner_id, is_deleted FROM document WHERE organization_id = 7 AND is_deleted = false AND owner_id = 0x{ACTOR}"
    ));
    assert!(!sql.contains('*'));
}

#[test]
fn invalid_or_mismatched_read_context_is_rejected_before_sql() {
    let mut fa = access(&["document:read"]);
    assert!(document_parent_sql(0, ACTOR, Some(&fa)).is_err());
    assert!(document_parent_sql(7, ACTOR, None).is_err());
    for identity in ["", "unknown", "0x123", "'; SELECT * FROM document"] {
        assert!(document_parent_sql(7, identity, Some(&fa)).is_err());
    }
    fa.organization_id = 8;
    assert!(document_parent_sql(7, ACTOR, Some(&fa)).is_err());
    fa.organization_id = 7;
    fa.identity_hex = OTHER.into();
    assert!(document_parent_sql(7, ACTOR, Some(&fa)).is_err());
    fa.identity_hex = "not an identity".into();
    assert!(document_parent_sql(7, ACTOR, Some(&fa)).is_err());
}

#[test]
fn identity_normalization_is_shared_with_sql_policy() {
    let mut fa = access(&["document:read"]);
    fa.identity_hex = format!("0X{}", ACTOR.to_uppercase());
    let (_, identity) = document_parent_sql(7, ACTOR, Some(&fa)).unwrap();
    let mut row = parent(json!(19));
    row["ownerId"] = json!(fa.identity_hex);
    assert_eq!(
        visible_document_ids(&[row], 7, &identity),
        BTreeSet::from([19])
    );
}

#[test]
fn parent_allowlist_excludes_missing_cross_org_other_owner_and_deleted_documents() {
    let valid = parent(json!(19));
    let mut cross_org = parent(json!(20));
    cross_org["organizationId"] = json!(8);
    let mut other_owner = parent(json!(21));
    other_owner["ownerId"] = json!(OTHER);
    let mut deleted = parent(json!(22));
    deleted["isDeleted"] = json!(true);
    let snake = json!({"id": "23", "organization_id": "7", "owner_id": ACTOR, "is_deleted": false});
    let ids = visible_document_ids(
        &[
            valid.clone(),
            valid,
            cross_org,
            other_owner,
            deleted,
            snake,
            json!({}),
        ],
        7,
        &format!("0x{ACTOR}"),
    );
    assert_eq!(ids, BTreeSet::from([19, 23]));
    assert!(!ids.contains(&999)); // No parent row means no authority for an orphan.
}

#[test]
fn malformed_parent_ids_org_owner_and_deleted_state_fail_closed() {
    let invalid_ids = [
        Value::Null,
        json!(0),
        json!(-1),
        json!(1.5),
        json!(""),
        json!("+7"),
        json!(" 7"),
        json!("18446744073709551616"),
        json!("7 OR 1=1"),
        json!({"some": [7]}),
        json!({"none": []}),
        json!(true),
    ];
    let identity = format!("0x{ACTOR}");
    for value in invalid_ids {
        for field in ["id", "organizationId"] {
            let mut row = parent(json!(19));
            row[field] = value.clone();
            assert!(
                visible_document_ids(&[row], 7, &identity).is_empty(),
                "{field}: {value}"
            );
        }
    }
    for value in [
        Value::Null,
        json!("bad"),
        json!([ACTOR]),
        json!({"some": ACTOR}),
        json!(true),
    ] {
        let mut row = parent(json!(19));
        row["ownerId"] = value;
        assert!(visible_document_ids(&[row], 7, &identity).is_empty());
    }
    for field in ["id", "organizationId", "ownerId", "isDeleted"] {
        let mut row = parent(json!(19));
        row.as_object_mut().unwrap().remove(field);
        assert!(
            visible_document_ids(&[row], 7, &identity).is_empty(),
            "{field}"
        );
    }
    for value in [Value::Null, json!("false"), json!(0), json!({"none": []})] {
        let mut row = parent(json!(19));
        row["isDeleted"] = value;
        assert!(visible_document_ids(&[row], 7, &identity).is_empty());
    }
    assert!(visible_document_ids(&[parent(json!(19))], 0, &identity).is_empty());
    assert!(visible_document_ids(&[parent(json!(19))], 7, "bad").is_empty());
}

#[test]
fn conflicting_scope_encodings_fail_closed() {
    let identity = format!("0x{ACTOR}");
    for (key, value) in [
        ("organization_id", json!(8)),
        ("owner_id", json!(OTHER)),
        ("is_deleted", json!(true)),
    ] {
        let mut row = parent(json!(19));
        row[key] = value;
        assert!(
            visible_document_ids(&[row], 7, &identity).is_empty(),
            "{key}"
        );
    }
    let mut rows = vec![json!({"organizationId": 7, "documentId": 19, "document_id": 20})];
    filter_document_child_rows(&mut rows, 7, &BTreeSet::from([19]), false);
    assert!(rows.is_empty());
}

#[test]
fn positive_u64_boundaries_are_lossless() {
    let identity = format!("0x{ACTOR}");
    let ids = visible_document_ids(
        &[parent(json!(u64::MAX)), parent(json!(u64::MAX.to_string()))],
        7,
        &identity,
    );
    assert_eq!(ids, BTreeSet::from([u64::MAX]));
    assert_eq!(
        document_row_id(
            &json!({"document_id": "9007199254740993"}),
            "documentId",
            "document_id"
        ),
        Some(9_007_199_254_740_993)
    );
}

#[test]
fn every_child_query_is_bounded_by_org_and_authorized_parent_ids() {
    let fa = access(&["document:read"]);
    for resource in RESOURCES {
        let (sql, _) = document_child_sql(resource, 7, &[19, u64::MAX], Some(&fa)).unwrap();
        let columns = resolve_http_sql_columns(resource, Some(&fa)).unwrap();
        assert!(sql.starts_with(&format!("SELECT {} FROM ", columns.join(", "))));
        assert!(sql.ends_with(&format!(
            "WHERE organization_id = 7 AND (document_id = 19 OR document_id = {})",
            u64::MAX
        )));
        assert!(!sql.contains("SELECT *"));

        assert!(document_child_sql(resource, 7, &[], Some(&fa)).is_err());
        assert!(document_child_sql(resource, 0, &[19], Some(&fa)).is_err());
        assert!(document_child_sql(resource, 7, &[0], Some(&fa)).is_err());
    }
    assert!(document_child_sql("documents", 7, &[19], Some(&fa)).is_err());
    assert!(document_child_sql("document_legal_hold", 7, &[19], Some(&fa)).is_err());
}

#[test]
fn child_filter_rejects_orphans_cross_org_and_malformed_relations() {
    let mut rows = vec![
        json!({"id": 1, "organizationId": 7, "documentId": 19}),
        json!({"id": 2, "organization_id": "7", "document_id": "19"}),
        json!({"id": 3, "organizationId": 8, "documentId": 19}),
        json!({"id": 4, "organizationId": 7, "documentId": 999}),
        json!({"id": 5, "organizationId": 7}),
        json!({"id": 6, "documentId": 19}),
    ];
    for value in [
        Value::Null,
        json!(0),
        json!("bad"),
        json!(1.5),
        json!({"some": 19}),
    ] {
        rows.push(json!({"organizationId": 7, "documentId": value}));
        rows.push(json!({"organizationId": value, "documentId": 19}));
    }
    filter_document_child_rows(&mut rows, 7, &BTreeSet::from([19]), false);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["id"], 1);
    assert_eq!(rows[1]["id"], 2);
    filter_document_child_rows(&mut rows, 7, &BTreeSet::new(), false);
    assert!(rows.is_empty());
}

#[test]
fn internal_relation_column_does_not_override_field_projection() {
    for resource in RESOURCES {
        let mut fa = access(&["document:read"]);
        fa.field_permissions.push(FieldPermissionLike {
            id: None,
            organization_id: Some(7),
            resource: resource.into(),
            action: "read".into(),
            role_id: Some(3),
            subject_role_id: None,
            subject_user_hex: None,
            allowed_fields: vec!["id".into()],
        });
        let columns = resolve_http_sql_columns(resource, Some(&fa)).unwrap();
        let projected = columns.iter().any(|column| column == "document_id");
        let (sql, strip) = document_child_sql(resource, 7, &[19], Some(&fa)).unwrap();
        assert_eq!(strip, !projected);
        assert!(sql.contains("document_id"));
        assert!(!sql.contains("reason"));
        assert!(!sql.contains("external_id"));
        assert!(!sql.contains("external_envelope_id"));
        let mut rows = vec![json!({"id": 1, "organizationId": 7, "documentId": 19})];
        filter_document_child_rows(&mut rows, 7, &BTreeSet::from([19]), strip);
        assert_eq!(rows[0].get("documentId").is_some(), projected);
    }
    let mut rows = vec![json!({"id": 1, "organization_id": 7, "document_id": 19})];
    filter_document_child_rows(&mut rows, 7, &BTreeSet::from([19]), true);
    assert!(rows[0].get("document_id").is_none());
}

// Exercise the real helper and StdbClient decoding with a local SQL HTTP fixture.
// This proves query ordering/bounding and returned rows, not live STDB deployment.
async fn sql_fixture(
    responses: Vec<Value>,
) -> (
    StdbClient,
    std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    tokio::task::JoinHandle<()>,
) {
    use axum::{routing::post, Json, Router};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    let queries = Arc::new(Mutex::new(Vec::new()));
    let pending = Arc::new(Mutex::new(VecDeque::from(responses)));
    let recorded = queries.clone();
    let app = Router::new().route(
        "/v1/database/documents/sql",
        post(move |sql: String| {
            let recorded = recorded.clone();
            let pending = pending.clone();
            async move {
                recorded.lock().unwrap().push(sql);
                Json(
                    pending
                        .lock()
                        .unwrap()
                        .pop_front()
                        .expect("unexpected SQL query"),
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (
        StdbClient::new(
            format!("http://{address}"),
            "documents".into(),
            "fixture-token".into(),
        ),
        queries,
        server,
    )
}

fn parent_response(rows: Vec<Value>) -> Value {
    json!([{"schema": {"elements": [
        {"name": {"some": "id"}, "algebraic_type": {"U64": []}},
        {"name": {"some": "organization_id"}, "algebraic_type": {"U64": []}},
        {"name": {"some": "owner_id"}, "algebraic_type": {"String": []}},
        {"name": {"some": "is_deleted"}, "algebraic_type": {"Bool": []}}
    ]}, "rows": rows}])
}

#[tokio::test]
async fn real_child_reader_returns_only_live_owned_parent_relations() {
    for resource in RESOURCES {
        let responses = vec![
            parent_response(vec![
                json!([19, 7, ACTOR, false]),
                json!([20, 7, OTHER, false]),
                json!([21, 8, ACTOR, false]),
                json!([22, 7, ACTOR, true]),
            ]),
            json!([{"schema": {"elements": [
                {"name": {"some": "id"}, "algebraic_type": {"U64": []}},
                {"name": {"some": "organization_id"}, "algebraic_type": {"U64": []}},
                {"name": {"some": "document_id"}, "algebraic_type": {"U64": []}}
            ]}, "rows": [[1, 7, 19], [3, 7, 19], [4, 7, 20], [5, 7, 21], [6, 7, 22], [7, 7, 999], [8, 8, 19]]}]),
        ];
        let (client, queries, server) = sql_fixture(responses).await;
        let fa = access(&["document:read"]);
        let result = super::super::execute_resource_query_for_company(
            &client,
            resource,
            7,
            ACTOR,
            Some(&fa),
            None,
        )
        .await
        .unwrap();
        server.abort();
        assert_eq!(
            result
                .iter()
                .map(|row| row["id"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![3, 1]
        );
        let queries = queries.lock().unwrap();
        assert_eq!(queries.len(), 2);
        assert!(queries[0].contains("is_deleted = false AND owner_id ="));
        assert!(queries[1].ends_with("WHERE organization_id = 7 AND (document_id = 19)"));
    }
}

#[tokio::test]
async fn no_visible_parent_means_no_child_query() {
    let (client, queries, server) =
        sql_fixture(vec![parent_response(vec![json!([19, 7, OTHER, false])])]).await;
    let fa = access(&["document:read"]);
    let rows = read_document_child_rows(&client, RESOURCES[0], 7, ACTOR, Some(&fa))
        .await
        .unwrap();
    server.abort();
    assert!(rows.is_empty());
    assert_eq!(queries.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn denied_context_and_unknown_resource_issue_no_database_queries() {
    let (client, queries, server) = sql_fixture(vec![]).await;
    let denied = access(&["document:write"]);
    let allowed = access(&["document:read"]);
    assert!(
        read_document_child_rows(&client, RESOURCES[0], 7, ACTOR, Some(&denied))
            .await
            .is_err()
    );
    assert!(
        read_document_child_rows(&client, RESOURCES[0], 0, ACTOR, Some(&allowed))
            .await
            .is_err()
    );
    assert!(
        read_document_child_rows(&client, "documents", 7, ACTOR, Some(&allowed))
            .await
            .is_err()
    );
    server.abort();
    assert!(queries.lock().unwrap().is_empty());
}
