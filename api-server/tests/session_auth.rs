//! Auth-hardening session tests (Phase 1–2): no anonymous admin, JWT-bound identity.

use api_server::config::Config;
use api_server::session::{decode_identity_hex_from_stdb_token, resolve_api_session};
use api_server::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};

fn test_config(server_token: Option<&str>, dev_mock_org_id: Option<u64>) -> Config {
    Config {
        port: 8082,
        stdb_host: "http://127.0.0.1:3000".into(),
        stdb_module: "test-module".into(),
        stdb_server_token: server_token.map(str::to_string),
        cors_origins: vec![],
        dev_mock_org_id,
        ai_gateway_url: "http://127.0.0.1:3001".into(),
        workos_client_id: None,
        stdb_credential_encryption_key: None,
        resend_api_key: None,
        resend_from_email: "test@example.com".into(),
        app_url: "http://localhost:3000".into(),
        cookie_secure: false,
        report_renderer_url: None,
        report_artifact_dir: std::env::temp_dir().join("lumiere-owner-reports-test"),
        document_blob_dir: std::env::temp_dir().join("lumiere-document-blobs-test"),
        owner_report_worker_poll_secs: 15,
        owner_report_worker_name: "test-owner-report-worker".to_string(),
        owner_report_worker_port: 8091,
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
async fn x_stdb_identity_header_does_not_grant_identity_without_jwt_claim() {
    let state = AppState::new(test_config(None, None));
    let token = fake_jwt(r#"{"iss":"spacetimedb"}"#);
    let auth = format!("Bearer {token}");
    let session = resolve_api_session(&state, Some(&auth), None, Some(VALID_IDENTITY_HEX))
        .await
        .expect("resolve should not error");
    assert!(session.is_none());
}

#[test]
fn decode_identity_hex_from_stdb_token_reads_hex_identity_claim() {
    let token = fake_jwt(&format!(r#"{{"hex_identity":"{VALID_IDENTITY_HEX}"}}"#));
    assert_eq!(
        decode_identity_hex_from_stdb_token(&token).as_deref(),
        Some(VALID_IDENTITY_HEX)
    );
}
