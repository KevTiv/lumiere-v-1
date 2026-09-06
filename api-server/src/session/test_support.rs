//! Shared test-only session configuration; never loaded by production.
use crate::config::Config;

pub(crate) fn test_config(server_token: Option<&str>) -> Config {
    Config {
        port: 8082,
        stdb_host: "http://127.0.0.1:3000".into(),
        stdb_module: "test-module".into(),
        stdb_server_token: server_token.map(str::to_string),
        stdb_finalization_token: None,
        cors_origins: vec![],
        dev_mock_org_id: None,
        ai_gateway_url: "http://127.0.0.1:3001".into(),
        ai_gateway_required: false,
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
