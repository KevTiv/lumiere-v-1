//! Auth-hardening session tests (Phase 1–2): no anonymous admin, database-bound identity.

use api_server::config::{Config, DocumentBlobStoreConfig, ReportArtifactStoreConfig};
use api_server::organization_placement::{
    ConfiguredPlacementResolver, INITIAL_CELL_ID, INITIAL_DURABLE_STORE_ID,
};
use api_server::session::resolve_api_session;
use api_server::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use stdb_client::normalize_spacetime_identity_header;

fn test_config(server_token: Option<&str>, dev_mock_org_id: Option<u64>) -> Config {
    Config {
        port: 8082,
        stdb_host: "http://127.0.0.1:3000".into(),
        stdb_module: "test-module".into(),
        stdb_server_token: server_token.map(str::to_string),
        stdb_finalization_token: None,
        organization_placement: ConfiguredPlacementResolver::new(
            INITIAL_CELL_ID,
            1,
            INITIAL_DURABLE_STORE_ID,
        )
        .expect("valid test placement"),
        cors_origins: vec![],
        dev_mock_org_id,
        ai_gateway_url: "http://127.0.0.1:3001".into(),
        projection_lag_budget_secs: 300,
        workos_auth: None,
        stdb_credential_encryption_key: None,
        resend_api_key: None,
        resend_from_email: "test@example.com".into(),
        app_url: "http://localhost:3000".into(),
        cookie_secure: false,
        report_renderer_url: None,
        report_artifact_store: ReportArtifactStoreConfig::Local {
            root: std::env::temp_dir().join("lumiere-owner-reports-test"),
        },
        document_blob_store: DocumentBlobStoreConfig::Local {
            root: std::env::temp_dir().join("lumiere-document-blobs-test"),
        },
        owner_report_worker_poll_secs: 15,
        owner_report_worker_name: "test-owner-report-worker".to_string(),
        owner_report_worker_port: 8091,
        workflow_worker_poll_secs: 15,
        workflow_worker_name: "test-workflow-worker".to_string(),
        workflow_worker_port: 8093,
        workflow_worker_org_ids: vec![],
        workflow_worker_lease_ttl_secs: 60,
        workflow_external_dispatch_enabled: false,
        workflow_external_dispatch_company_ids: vec![],
        workflow_external_dispatch_action_keys: vec![],
        workflow_external_webhook_url: None,
        workflow_external_webhook_timeout_ms: 10_000,
    }
}

fn fake_jwt(payload_json: &str) -> String {
    let header = STANDARD.encode(b"{\"alg\":\"none\"}");
    let payload = STANDARD.encode(payload_json.as_bytes());
    format!("{header}.{payload}.sig")
}

const VALID_IDENTITY_HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[tokio::test]
async fn no_bearer_or_cookie_returns_none_even_with_server_token_configured() {
    let state = AppState::new(test_config(Some("configured-server-admin-token"), None));
    let session = resolve_api_session(&state, None, None, None)
        .await
        .expect("resolve should not error");
    assert!(session.is_none());
}

#[tokio::test]
async fn import_routes_match_real_entity_and_request_paths_before_requiring_auth() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        Router,
    };
    use std::sync::Arc;
    use tower::ServiceExt;
    use tower_cookies::CookieManagerLayer;

    let state = Arc::new(AppState::new(test_config(None, None)));
    let app = Router::new()
        .nest("/v1", api_server::routes::domain_router())
        .layer(CookieManagerLayer::new())
        .with_state(state);
    for (method, path, body) in [
        (
            "POST",
            "/v1/finance-reviews/finance_report_review",
            r#"{"companyId":1,"inputs":{"reportKey":"customer_balances_v1","date":"2026-10-26","timezone":"UTC"}}"#,
        ),
        (
            "POST",
            "/v1/finance-reviews/bank_reconciliation_review",
            r#"{"companyId":1,"inputs":{"statementId":1}}"#,
        ),
        (
            "POST",
            "/v1/finance-reviews/period_close_review",
            r#"{"companyId":1,"inputs":{"periodId":1}}"#,
        ),
        (
            "POST",
            "/v1/finance-reviews/expense_evidence_review",
            r#"{"companyId":1,"inputs":{"recordId":1,"recordKind":"expense"}}"#,
        ),
        (
            "POST",
            "/v1/finance-reviews/finance_variance_review",
            r#"{"companyId":1,"inputs":{"reportKey":"customer_balances_v1","actualDate":"2026-10-26","baselineDate":"2026-10-25","timezone":"UTC"}}"#,
        ),
        (
            "POST",
            "/v1/import/hr_payslip",
            r#"{"csvData":"employee_id,struct_id\n1,2\n"}"#,
        ),
        (
            "GET",
            "/v1/import/hr_payslip/requests/0123456789abcdef0123456789abcdef?companyId=1",
            "",
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path}"
        );
    }
}

#[test]
fn alg_none_jwt_payload_is_not_an_authenticated_identity_header() {
    let token = fake_jwt(&format!(r#"{{"identity":"{VALID_IDENTITY_HEX}"}}"#));
    assert_eq!(normalize_spacetime_identity_header(&token), None);
}
