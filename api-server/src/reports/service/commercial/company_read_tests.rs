use super::*;
use serde_json::json;

fn contact(id: u64, company: Option<u64>, deleted: bool) -> Value {
    json!({"id":id,"organization_id":7,"company_id":company,"display_name":format!("Supplier {id}"),"deleted_at":if deleted {json!("deleted")} else {Value::Null}})
}

#[tokio::test]
async fn nullable_company_contacts_keep_only_live_selected_and_shared_rows() {
    let server = crate::company_read_test_support::serve(|sql| {
        assert!(!sql.contains("company_id ="));
        assert!(!sql.contains("IS NULL"));
        assert!(sql.contains("organization_id = 7"));
        assert!(sql.ends_with(&format!("LIMIT {QUERY_LIMIT}")));
        vec![
            contact(21, Some(9), false),
            contact(22, None, false),
            contact(23, Some(10), false),
            contact(24, Some(9), true),
        ]
    })
    .await;
    let rows = purchase_contacts(&server.client, 7, 9).await.unwrap();
    assert_eq!(
        rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![21, 22]
    );
    assert_eq!(rows[0].display_name, "Supplier 21");
}

#[tokio::test]
async fn nullable_company_contacts_reject_missing_malformed_and_foreign_scope() {
    let valid = contact(21, Some(9), false);
    let mut cases = Vec::new();
    for key in ["company_id", "deleted_at", "organization_id"] {
        let mut row = valid.clone();
        row.as_object_mut().unwrap().remove(key);
        cases.push(row);
    }
    for (key, value) in [
        ("company_id", json!("malformed")),
        ("organization_id", json!(8)),
    ] {
        let mut row = valid.clone();
        row[key] = value;
        cases.push(row);
    }
    for row in cases {
        let server = crate::company_read_test_support::serve(move |_| vec![row.clone()]).await;
        assert!(purchase_contacts(&server.client, 7, 9).await.is_err());
    }
}

#[tokio::test]
async fn nullable_company_contacts_enforce_source_bound_before_filtering() {
    let server =
        crate::company_read_test_support::serve(|_| vec![contact(21, Some(10), false); 1001]).await;
    assert!(matches!(
        purchase_contacts(&server.client, 7, 9).await,
        Err(ApiError::Unprocessable(_))
    ));
}
