use super::*;
use axum::{
    extract::State,
    http::{StatusCode, Uri},
    routing::post,
    Router,
};
use serde_json::json;
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::Mutex;

fn actor() -> String {
    "ab".repeat(32)
}

fn access(permissions: &[&str]) -> FieldAccessContext {
    FieldAccessContext {
        organization_id: 3,
        role_id: 9,
        role_name: "hr-test".into(),
        is_superuser: false,
        role_permissions: permissions
            .iter()
            .map(|permission| (*permission).into())
            .collect(),
        identity_hex: actor(),
        field_permissions: vec![],
    }
}

#[test]
fn child_read_requires_read_grant_not_mutation_or_sensitive_field_grant() {
    for resource in [
        "hr-leave-allocations",
        "hr-offboarding-checklists",
        "hr-statutory-ids",
    ] {
        assert!(!has_hr_child_read_permission(None, resource));
        for permissions in [
            vec![],
            vec![
                "hr_employee:create",
                "hr_employee:update",
                "hr_leave:create",
            ],
            vec!["hr_employee:view_statutory_id"],
            vec!["hr_employee:view_pii"],
            vec!["module:crm:read"],
        ] {
            assert!(!has_hr_child_read_permission(
                Some(&access(&permissions)),
                resource
            ));
        }
        for permission in ["*:*", "module:hr:read", "module:hr:*"] {
            assert!(has_hr_child_read_permission(
                Some(&access(&[permission])),
                resource
            ));
        }
        assert!(has_hr_child_read_permission(
            Some(&access(&[&format!("{resource}:read")])),
            resource
        ));
        assert!(has_hr_child_read_permission(
            Some(&access(&[&format!(
                "{}:read",
                hr_child_table(resource).unwrap()
            )])),
            resource
        ));
    }
    assert!(!has_hr_child_read_permission(
        Some(&access(&["*:*"])),
        "unknown"
    ));
}

#[test]
fn child_read_preserves_canonical_domain_and_registry_alias_grants() {
    for permission in ["hr_leave:read", "hr_leave:*", "leave-requests:read"] {
        let fa = access(&[permission]);
        assert!(has_hr_child_read_permission(
            Some(&fa),
            "hr-leave-allocations"
        ));
        assert!(!has_hr_child_read_permission(
            Some(&fa),
            "hr-offboarding-checklists"
        ));
        assert!(!has_hr_child_read_permission(Some(&fa), "hr-statutory-ids"));
    }
    for permission in ["hr_employee:read", "hr_employee:*", "employees:read"] {
        let fa = access(&[permission]);
        assert!(has_hr_child_read_permission(
            Some(&fa),
            "hr-offboarding-checklists"
        ));
        assert!(has_hr_child_read_permission(Some(&fa), "hr-statutory-ids"));
        assert!(hr_child_can_list_all_employees(Some(&fa)));
    }
}

#[test]
fn parent_scope_does_not_trust_child_tenant_or_a_forged_employee_id() {
    let parents = vec![
        json!({"id": 41, "organizationId": 3, "companyId": 7}),
        json!({"id": 42, "organizationId": 4, "companyId": 7}),
        json!({"id": 43, "organizationId": 3, "companyId": 8}),
        json!({"id": 44, "organizationId": 3}),
        json!({"id": 45, "companyId": 7}),
        json!({"id": 0, "organizationId": 3, "companyId": 7}),
        json!({"organizationId": 3, "companyId": 7}),
        json!({"id": "invalid", "organizationId": 3, "companyId": 7}),
    ];
    let visible = hr_visible_employee_ids(
        &parents,
        3,
        7,
        &actor(),
        Some(&access(&["hr_employee:read"])),
    );
    assert_eq!(visible, HashSet::from([41]));
    let mut children = vec![
        json!({"id": 1, "employeeId": 41, "organizationId": 3, "companyId": 7}),
        json!({"id": 2, "employeeId": 42, "organizationId": 3, "companyId": 7}),
        json!({"id": 3, "employeeId": 43, "organizationId": 3, "companyId": 7}),
        json!({"id": 4, "employeeId": 999, "organizationId": 3, "companyId": 7}),
        json!({"id": 5, "organizationId": 3, "companyId": 7}),
        json!({"id": 6, "employeeId": 0, "organizationId": 3, "companyId": 7}),
        json!({"id": 7, "employeeId": "invalid", "organizationId": 3, "companyId": 7}),
        json!({"id": 8, "employeeId": 41, "organizationId": 4, "companyId": 7}),
        json!({"id": 9, "employeeId": 41, "organizationId": 3, "companyId": 8}),
        json!({"id": 10, "employeeId": 41, "organizationId": 3, "companyId": null}),
    ];
    filter_hr_child_rows(&mut children, 3, 7, &visible);
    assert_eq!(children.len(), 1);
    assert_eq!(children[0]["id"], 1);
    filter_hr_child_rows(&mut children, 3, 7, &HashSet::new());
    assert!(children.is_empty());
}

#[test]
fn scope_and_relation_option_encodings_fail_closed_for_none_or_malformed_ids() {
    for company in [
        json!(7),
        json!("7"),
        json!({"some": [7]}),
        json!({"Some": "7"}),
    ] {
        let parent = json!({"id": "41", "organization_id": "3", "company_id": company});
        assert!(hr_row_in_scope(&parent, 3, 7));
        let visible = hr_visible_employee_ids(
            &[parent],
            3,
            7,
            &actor(),
            Some(&access(&["hr_employee:read"])),
        );
        for employee in [
            json!(41),
            json!("41"),
            json!({"some": [41]}),
            json!({"Some": "41"}),
        ] {
            let mut rows =
                vec![json!({"organization_id": 3, "company_id": company, "employee_id": employee})];
            filter_hr_child_rows(&mut rows, 3, 7, &visible);
            assert_eq!(rows.len(), 1);
        }
    }
    for invalid in [
        Value::Null,
        json!({"none": []}),
        json!({"some": []}),
        json!({"some": "bad"}),
        json!(-1),
        json!(0),
    ] {
        assert!(!hr_row_in_scope(
            &json!({"organizationId": 3, "companyId": invalid}),
            3,
            7
        ));
        assert!(hr_child_employee_id(&json!({"employeeId": invalid})).is_none());
    }
}

#[test]
fn dedicated_child_grant_still_requires_authoritative_employee_ownership() {
    let fa = access(&["hr_leave_allocation:read"]);
    let own = actor();
    let other = "cd".repeat(32);
    let parents = vec![
        json!({"id": 41, "organizationId": 3, "companyId": 7, "userId": own}),
        json!({"id": 42, "organizationId": 3, "companyId": 7, "userId": {"some": [format!("0X{}", own.to_uppercase())]}}),
        json!({"id": 43, "organizationId": 3, "companyId": 7, "userId": {"Some": other}}),
        json!({"id": 44, "organizationId": 3, "companyId": 7, "userId": {"none": []}}),
        json!({"id": 45, "organizationId": 3, "companyId": 7}),
        // Being a manager or a child-row creator is not employee ownership.
        json!({"id": 46, "organizationId": 3, "companyId": 7, "userId": other, "parentId": 41}),
    ];
    assert_eq!(
        hr_visible_employee_ids(&parents, 3, 7, &own, Some(&fa)),
        HashSet::from([41, 42])
    );
    assert_eq!(
        hr_visible_employee_ids(&parents, 3, 7, &own, Some(&access(&["hr_employee:read"]))),
        HashSet::from([41, 42, 43, 44, 45, 46])
    );
}

#[test]
fn parent_query_uses_only_supported_scoped_equality_predicates() {
    assert_eq!(hr_employee_parent_sql(3, 7, &[41, 42]),
        "SELECT id, organization_id, company_id, user_id FROM hr_employee WHERE organization_id = 3 AND company_id = 7 AND (id = 41 OR id = 42)");
}

#[test]
fn statutory_value_is_separately_gated_and_audit_contains_no_values() {
    let resource = "hr-statutory-ids";
    let metadata =
        resolve_http_sql_columns(resource, Some(&access(&["hr_employee:read"]))).unwrap();
    assert!(!metadata.iter().any(|column| column == "value"));
    let sensitive = resolve_http_sql_columns(
        resource,
        Some(&access(&[
            "hr_employee:read",
            "hr_employee:view_statutory_id",
        ])),
    )
    .unwrap();
    assert!(sensitive.iter().any(|column| column == "value"));
    let rows = vec![json!({"id": 81, "value": "SECRET-STATUTORY-VALUE"})];
    let args = hr_child_audit_args(3, 7, resource, "hr_statutory_id", &sensitive, &rows).unwrap();
    assert_eq!(args[0], 3);
    assert_eq!(args[1]["company_id"], json!({"some": 7}));
    assert_eq!(args[1]["purpose"], "hr_admin");
    assert_eq!(args[1]["resource_key"], resource);
    assert_eq!(args[1]["table_name"], "hr_statutory_id");
    assert_eq!(args[1]["record_id"], 81);
    assert_eq!(args[1]["row_count"], 1);
    assert!(!args.to_string().contains("SECRET-STATUTORY-VALUE"));
    let bulk = hr_child_audit_args(
        3,
        7,
        resource,
        "hr_statutory_id",
        &sensitive,
        &[rows[0].clone(), rows[0].clone()],
    )
    .unwrap();
    assert_eq!(bulk[1]["record_id"], 0);
    assert_eq!(bulk[1]["row_count"], 2);
}

struct Reply {
    body_contains: String,
    response: Value,
    status: StatusCode,
}

fn sql_reply(body_contains: &str, rows: &[Value]) -> Reply {
    let names: Vec<String> = rows
        .first()
        .and_then(Value::as_object)
        .map(|row| row.keys().cloned().collect())
        .unwrap_or_default();
    Reply {
        body_contains: body_contains.into(),
        status: StatusCode::OK,
        response: json!([{
            "schema": {"elements": names.iter().map(|name| json!({"name": {"some": name}})).collect::<Vec<_>>()},
            "rows": rows.iter().map(|row| names.iter().map(|name| row[name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()
        }]),
    }
}

type Replies = Arc<Mutex<VecDeque<Reply>>>;

struct MockStdb {
    client: StdbClient,
    replies: Replies,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for MockStdb {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn mock_stdb(replies: Vec<Reply>) -> MockStdb {
    async fn respond(
        State(replies): State<Replies>,
        uri: Uri,
        body: String,
    ) -> (StatusCode, String) {
        let reply = replies
            .lock()
            .await
            .pop_front()
            .expect("unexpected STDB request");
        assert!(
            body.contains(&reply.body_contains),
            "unexpected request body: {body}"
        );
        if uri.path().ends_with("/sql") {
            assert!(body.contains("organization_id = 3"));
            assert!(!body.contains("SELECT *"));
            assert!(!body.contains(" IN "));
            if !body.contains("FROM user_organization") {
                assert!(body.contains("company_id = 7"));
            }
        } else {
            assert!(uri.path().ends_with("/call/log_hr_pii_read"));
            let args: Value = serde_json::from_str(&body).unwrap();
            assert_eq!(args[1]["company_id"], json!({"some": 7}));
            assert_eq!(args[1]["purpose"], "hr_admin");
            assert_eq!(
                args[1]["fields_accessed"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|field| *field == "value")
                    .count(),
                1
            );
            assert!(!body.contains("SECRET-STATUTORY-VALUE"));
        }
        (reply.status, reply.response.to_string())
    }
    let replies = Arc::new(Mutex::new(VecDeque::from(replies)));
    let app = Router::new()
        .route("/v1/database/test/sql", post(respond))
        .route("/v1/database/test/call/log_hr_pii_read", post(respond))
        .with_state(replies.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    MockStdb {
        client: StdbClient::new(
            format!("http://{address}"),
            "test".into(),
            "actor-token".into(),
        ),
        replies,
        task,
    }
}

fn membership_reply() -> Reply {
    sql_reply(
        "FROM user_organization",
        &[json!({"id": 9, "organization_id": 3, "company_id": {"some": 7}, "is_active": true})],
    )
}

#[test]
fn membership_http_option_fixture_decodes_to_scalar_company_id() {
    let reply = membership_reply();
    let rows = stdb_client::parse_sats_sql_response(&reply.response.to_string()).unwrap();
    assert_eq!(rows[0]["companyId"], json!(7));
    assert_eq!(
        row_u64(&rows[0], "companyId", "company_id").unwrap(),
        Some(7)
    );
}

#[tokio::test]
async fn helper_denies_missing_permission_and_mismatched_authorization_context_before_sql() {
    let mock = mock_stdb(vec![]).await;
    let mut wrong_org = access(&["*:*"]);
    wrong_org.organization_id = 4;
    let mut wrong_actor = access(&["*:*"]);
    wrong_actor.identity_hex = "cd".repeat(32);
    for fa in [None, Some(access(&[])), Some(wrong_org), Some(wrong_actor)] {
        let result = read_hr_child_rows(
            &mock.client,
            "hr-leave-allocations",
            3,
            &actor(),
            fa.as_ref(),
            Some(7),
        )
        .await;
        assert!(matches!(result, Err(ApiError::Forbidden(_))));
    }
    assert!(mock.replies.lock().await.is_empty());
}

#[tokio::test]
async fn helper_denies_missing_membership_and_forged_requested_company() {
    for (reply, company) in [
        (sql_reply("FROM user_organization", &[]), 7),
        (membership_reply(), 8),
    ] {
        let mock = mock_stdb(vec![reply]).await;
        let result = read_hr_child_rows(
            &mock.client,
            "hr-statutory-ids",
            3,
            &actor(),
            Some(&access(&["hr_employee:read"])),
            Some(company),
        )
        .await;
        assert!(matches!(result, Err(ApiError::Forbidden(_))));
        assert!(mock.replies.lock().await.is_empty());
    }
}

#[tokio::test]
async fn helper_checks_actual_parent_and_strips_internal_projection_fields() {
    for (resource, table, field, json_key, expected_value) in [
        (
            "hr-leave-allocations",
            "hr_leave_allocation",
            "allocated_days",
            "allocatedDays",
            json!(12.5),
        ),
        (
            "hr-offboarding-checklists",
            "hr_offboarding_checklist",
            "status",
            "status",
            json!("complete"),
        ),
        (
            "hr-statutory-ids",
            "hr_statutory_id",
            "id_kind",
            "idKind",
            json!("TFN"),
        ),
    ] {
        for parent in [
            None,
            Some(json!({"id": 41, "organization_id": 4, "company_id": 7})),
            Some(json!({"id": 41, "organization_id": 3, "company_id": 8})),
            Some(json!({"id": 41, "organization_id": 3, "company_id": 7})),
        ] {
            let expected_count = usize::from(
                parent
                    .as_ref()
                    .is_some_and(|row| row["organization_id"] == 3 && row["company_id"] == 7),
            );
            let mut fa = access(&["hr_employee:read"]);
            if resource == "hr-leave-allocations" {
                fa.role_permissions.push("hr_leave:read".into());
            }
            fa.field_permissions.push(stdb_auth::FieldPermissionLike {
                id: None,
                organization_id: Some(3),
                role_id: Some(9),
                resource: resource.into(),
                action: "read".into(),
                allowed_fields: vec![field.into()],
                subject_user_hex: None,
                subject_role_id: Some(9),
            });
            let mut child =
                json!({"id": 81, "organization_id": 3, "company_id": 7, "employee_id": 41});
            child[field] = expected_value.clone();
            let mock = mock_stdb(vec![
                membership_reply(),
                sql_reply(&format!("FROM {table}"), &[child]),
                sql_reply("AND (id = 41)", &parent.into_iter().collect::<Vec<_>>()),
            ])
            .await;
            let rows = super::super::execute_resource_query_for_company(
                &mock.client,
                resource,
                3,
                &actor(),
                Some(&fa),
                Some(7),
            )
            .await
            .unwrap();
            assert_eq!(rows.len(), expected_count, "resource: {resource}");
            for row in rows {
                assert_eq!(row[json_key], expected_value);
                let columns = resolve_http_sql_columns(resource, Some(&fa)).unwrap();
                assert_eq!(
                    row.get("employeeId").is_some(),
                    columns.iter().any(|column| column == "employee_id")
                );
                assert!(row.get("value").is_none());
                assert!(row.get("userId").is_none());
            }
            assert!(mock.replies.lock().await.is_empty());
        }
    }
}

#[tokio::test]
async fn helper_bounds_parent_queries_to_referenced_employee_batches() {
    let children: Vec<Value> = (41..=141)
        .map(|id| json!({"id": id, "organization_id": 3, "company_id": 7, "employee_id": id}))
        .collect();
    let mock = mock_stdb(vec![
        membership_reply(),
        sql_reply("FROM hr_leave_allocation", &children),
        sql_reply(
            "id = 140)",
            &[json!({"id": 41, "organization_id": 3, "company_id": 7})],
        ),
        sql_reply(
            "AND (id = 141)",
            &[json!({"id": 141, "organization_id": 3, "company_id": 7})],
        ),
    ])
    .await;
    let rows = read_hr_child_rows(
        &mock.client,
        "hr-leave-allocations",
        3,
        &actor(),
        Some(&access(&["module:hr:read"])),
        Some(7),
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["employeeId"], 41);
    assert_eq!(rows[1]["employeeId"], 141);
    assert!(mock.replies.lock().await.is_empty());
}

#[tokio::test]
async fn statutory_sensitive_audit_failure_never_returns_success() {
    for status in [StatusCode::OK, StatusCode::INTERNAL_SERVER_ERROR] {
        let mock = mock_stdb(vec![
            membership_reply(),
            sql_reply("FROM hr_statutory_id", &[json!({"id": 81, "organization_id": 3, "company_id": 7, "employee_id": 41, "value": "SECRET-STATUTORY-VALUE"})]),
            sql_reply("AND (id = 41)", &[json!({"id": 41, "organization_id": 3, "company_id": 7})]),
            Reply { body_contains: "hr-statutory-ids".into(), response: json!(null), status },
        ]).await;
        let fa = access(&["hr_employee:read", "hr_employee:view_statutory_id"]);
        let result = read_hr_child_rows(
            &mock.client,
            "hr-statutory-ids",
            3,
            &actor(),
            Some(&fa),
            Some(7),
        )
        .await;
        if status.is_success() {
            assert_eq!(result.unwrap()[0]["value"], "SECRET-STATUTORY-VALUE");
        } else {
            assert!(matches!(result, Err(ApiError::InternalSource(_))));
        }
        assert!(mock.replies.lock().await.is_empty());
    }
}
