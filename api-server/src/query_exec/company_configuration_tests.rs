use super::execute_resource_query_for_company;
use crate::{company_read_test_support::serve, error::ApiError};
use serde_json::{json, Value};

const ACTOR: &str = "abababababababababababababababababababababababababababababababab";

async fn fixture(
    wide: bool,
    membership: bool,
    selected: u64,
) -> crate::company_read_test_support::SqlFixture {
    serve(move |sql| {
        if sql.contains(" FROM user_organization ") {
            if !membership { return vec![]; }
            return vec![json!({"id":11,"organization_id":7,"company_id":9,"role_id":12,"is_active":true})];
        }
        if sql.contains(" FROM user_role_assignment ") { return vec![]; }
        if sql.contains(" FROM role ") {
            return vec![json!({"id":12,"name":"member","is_active":true,"permissions":if wide {vec!["*:*"]} else {vec!["delivery_carrier:read"]}})];
        }
        if sql.contains(" FROM company ") {
            return vec![
                json!({"id":8,"organization_id":7,"is_parent":true,"deleted_at":null}),
                json!({"id":9,"organization_id":7,"is_parent":false,"deleted_at":null}),
                json!({"id":10,"organization_id":7,"is_parent":false,"deleted_at":null}),
            ];
        }
        assert!(sql.contains(&format!("company_id = {selected}")), "{sql}");
        vec![json!({"id":31,"company_id":selected,"name":"Selected company configuration"})]
    }).await
}

#[tokio::test]
async fn company_configuration_reads_follow_membership_not_organization_default() {
    for resource in [
        "delivery-carriers",
        "delivery-price-rules",
        "shipping-methods",
        "pos-payment-methods",
    ] {
        for requested in [None, Some(9)] {
            let server = fixture(false, true, 9).await;
            let rows = execute_resource_query_for_company(
                &server.client,
                resource,
                7,
                ACTOR,
                None,
                requested,
            )
            .await
            .unwrap();
            assert_eq!(rows[0]["companyId"], 9);
            assert!(!server
                .requests
                .lock()
                .unwrap()
                .iter()
                .any(|sql| sql.contains(" FROM company ")));
        }
    }
}

#[tokio::test]
async fn company_configuration_reads_reject_foreign_selection_before_business_read() {
    for resource in [
        "delivery-carriers",
        "delivery-price-rules",
        "shipping-methods",
        "pos-payment-methods",
    ] {
        for (wide, member, requested) in [(false, true, 8), (true, true, 99), (false, false, 9)] {
            let server = fixture(wide, member, requested).await;
            let result = execute_resource_query_for_company(
                &server.client,
                resource,
                7,
                ACTOR,
                None,
                Some(requested),
            )
            .await;
            assert!(matches!(result, Err(ApiError::Forbidden(_))), "{result:?}");
            assert!(server.requests.lock().unwrap().iter().all(|sql| sql
                .contains(" FROM user_organization ")
                || sql.contains(" FROM user_role_assignment ")
                || sql.contains(" FROM role ")
                || sql.contains(" FROM company ")));
        }
    }
}

#[tokio::test]
async fn company_configuration_reads_honor_authorized_owner_company_selection() {
    let server = fixture(true, true, 10).await;
    let rows = execute_resource_query_for_company(
        &server.client,
        "delivery-carriers",
        7,
        ACTOR,
        None,
        Some(10),
    )
    .await
    .unwrap();
    assert_eq!(rows[0]["companyId"], Value::from(10));
}
