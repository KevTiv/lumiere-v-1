use super::*;

const ACTOR: &str = "abababababababababababababababababababababababababababababababab";
const RECEIPT: &str = "01234567-89ab-4cde-8f01-23456789abcd";

fn access() -> FieldAccessContext {
    FieldAccessContext {
        organization_id: 7,
        identity_hex: ACTOR.into(),
        role_permissions: vec!["sale_order:read".into()],
        ..Default::default()
    }
}

fn order(id: &str) -> Value {
    json!({"id":id, "organizationId":7, "companyId":3, "createUid":ACTOR,
        "metadata":json!({"sales_create_receipt":RECEIPT, "private_note":"internal"}).to_string()})
}

#[test]
fn lookup_requires_current_read_permission_and_exact_scope() {
    let mut denied = access();
    denied.role_permissions = vec!["sale_order:create".into()];
    assert!(creation_sql(7, 3, ACTOR, &denied).is_err());
    assert!(creation_sql(8, 3, ACTOR, &access()).is_err());
    assert!(creation_sql(7, 0, ACTOR, &access()).is_err());
    assert!(creation_sql(7, 3, "not-an-identity", &access()).is_err());
    let sql = creation_sql(7, 3, ACTOR, &access()).unwrap();
    assert!(
        sql.ends_with(&format!(
            "WHERE organization_id = 7 AND company_id = 3 AND create_uid = 0x{ACTOR}"
        )),
        "{sql}"
    );
    assert!(!sql.contains("SELECT *"));
}

#[test]
fn exact_receipt_returns_only_navigation_ids_with_full_u64_precision() {
    let row = order("9007199254740993");
    assert_eq!(
        creation_rows(&[row], RECEIPT, 7, 3, ACTOR),
        vec![json!({
            "id":"9007199254740993", "organizationId":"7", "companyId":"3", "receipt":RECEIPT,
        })]
    );
    let mut snake = order("12");
    let object = snake.as_object_mut().unwrap();
    for (camel, snake) in [
        ("organizationId", "organization_id"),
        ("companyId", "company_id"),
        ("createUid", "create_uid"),
    ] {
        let value = object.remove(camel).unwrap();
        object.insert(snake.into(), value);
    }
    snake["metadata"] = json!({"some":snake["metadata"]});
    assert_eq!(creation_rows(&[snake], RECEIPT, 7, 3, ACTOR)[0]["id"], "12");
}

#[test]
fn missing_duplicate_or_foreign_receipts_never_pick_a_draft() {
    let row = order("12");
    assert!(creation_rows(&[], RECEIPT, 7, 3, ACTOR).is_empty());
    assert!(creation_rows(&[row.clone(), order("13")], RECEIPT, 7, 3, ACTOR).is_empty());
    for (field, value) in [
        ("organizationId", json!(8)),
        ("companyId", json!(4)),
        ("createUid", json!("cd".repeat(32))),
        ("metadata", json!("{")),
        ("metadata", json!("{}")),
        ("metadata", Value::Null),
        ("id", json!(0)),
    ] {
        let mut invalid = row.clone();
        invalid[field] = value;
        assert!(
            creation_rows(&[invalid], RECEIPT, 7, 3, ACTOR).is_empty(),
            "{field}"
        );
    }
    assert!(creation_rows(&[row], "different", 7, 3, ACTOR).is_empty());
}

#[test]
fn receipt_must_be_a_uuid() {
    assert!(valid_receipt(RECEIPT));
    for invalid in [
        "",
        "x",
        "01234567-89ab-4cde-8f01-23456789abc'",
        "0123456789ab-4cde-8f01-23456789abcde",
    ] {
        assert!(!valid_receipt(invalid));
    }
}

#[test]
fn ordinary_order_reads_keep_metadata_hidden_even_when_other_fields_are_selected() {
    let mut actor = access();
    actor.field_permissions.push(serde_json::from_value(json!({
        "organizationId":7, "resource":"sale-orders", "action":"read", "allowedFields":["state"],
    })).unwrap());
    for fields in [None, Some(&access()), Some(&actor)] {
        let columns = stdb_auth::resolve_http_sql_columns("sale-orders", fields).unwrap();
        assert!(!columns.iter().any(|column| column == "metadata"));
    }
    let columns = stdb_auth::resolve_http_sql_columns("sale-orders", Some(&actor)).unwrap();
    assert!(!columns.iter().any(|column| column == "amount_total"));
    assert!(creation_sql(7, 3, ACTOR, &actor).is_ok());
}

#[tokio::test]
async fn authenticated_http_lookup_checks_membership_and_returns_no_internal_fields() {
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
        routing::post,
        Router,
    };
    use tower::ServiceExt;
    use tower_cookies::CookieManagerLayer;

    async fn sql(
        headers: HeaderMap,
        sql: String,
    ) -> ([(&'static str, &'static str); 1], Json<Value>) {
        let token = headers.get("authorization").unwrap().to_str().unwrap();
        let rows = if sql == "SELECT id FROM organization LIMIT 1" {
            vec![json!({"id":7})]
        } else if sql.contains(" FROM user_profile ") {
            assert_eq!(token, "Bearer authority-token");
            vec![
                json!({"identity":ACTOR, "organization_id":7, "is_active":true, "is_superuser":false}),
            ]
        } else if sql.contains(" FROM user_organization ") {
            assert!(sql.contains(ACTOR), "{sql}");
            vec![
                json!({"id":1, "organization_id":7, "company_id":3, "user_identity":ACTOR,
                "role_id":9, "is_active":true, "is_default":true}),
            ]
        } else if sql.contains(" FROM role ") {
            vec![
                json!({"id":9, "organization_id":7, "name":"Sales", "is_active":true, "permissions":["sale_order:read"]}),
            ]
        } else if sql.contains(" FROM field_permission ")
            || sql.contains(" FROM user_role_assignment ")
            || sql.contains(" FROM org_permission ")
        {
            vec![]
        } else if sql.contains(" FROM sale_order ") {
            assert_eq!(token, "Bearer actor-token");
            assert!(
                sql.contains(&format!(
                    "organization_id = 7 AND company_id = 3 AND create_uid = 0x{ACTOR}"
                )),
                "{sql}"
            );
            vec![
                json!({"id":"9007199254740993", "organization_id":7, "company_id":3, "create_uid":ACTOR,
                "metadata":{"some":json!({"sales_create_receipt":RECEIPT, "private_note":"INTERNAL"}).to_string()}}),
            ]
        } else {
            panic!("unexpected SQL: {sql}");
        };
        let columns: Vec<_> = sql
            .strip_prefix("SELECT ")
            .unwrap()
            .split_once(" FROM ")
            .unwrap()
            .0
            .split(", ")
            .collect();
        (
            [("spacetime-identity", ACTOR)],
            Json(json!([{
                "schema":{"elements":columns.iter().map(|name| json!({"name":{"some":name}})).collect::<Vec<_>>()},
                "rows":rows.iter().map(|row| columns.iter().map(|name| row[*name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()
            }])),
        )
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mock = Router::new().route("/v1/database/test-module/sql", post(sql));
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    let mut config = crate::session::test_support::test_config(Some("authority-token"));
    config.stdb_host = format!("http://{address}");
    let app = super::super::router()
        .layer(CookieManagerLayer::new())
        .with_state(Arc::new(AppState::new(config)));
    for (company, status) in [(3, StatusCode::OK), (4, StatusCode::FORBIDDEN)] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/sales/order-creations/{RECEIPT}?companyId={company}"
                    ))
                    .header("authorization", "Bearer actor-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let actual_status = response.status();
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        assert_eq!(actual_status, status, "{}", String::from_utf8_lossy(&body));
        if status == StatusCode::OK {
            assert_eq!(
                serde_json::from_slice::<Value>(&body).unwrap(),
                json!({"data":[{
                    "id":"9007199254740993", "organizationId":"7", "companyId":"3", "receipt":RECEIPT,
                }]})
            );
        }
    }
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/sales/order-creations/{RECEIPT}?companyId=3"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    server.abort();
}
