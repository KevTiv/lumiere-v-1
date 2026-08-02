//! Lumiere Axum API server — library surface for the `api-server` binary.

mod auth_password;
pub mod config;
pub mod document_blobs;
pub mod domain_queries;
pub mod error;
pub mod expense_integration_worker;
pub mod hr_integration_worker;
pub mod metrics;
mod middleware;
pub mod owner_report_worker;
pub mod project_integration_worker;
pub mod query_exec;
pub mod realtime;
pub mod reducer_allowlist;
pub mod reports;
pub mod routes;
pub mod session;
pub mod state;
pub mod web_session;
pub mod workflow_reads;
pub mod workflow_worker;

mod http_app;
mod stdb_sdk_bindings;

/// Run the HTTP server (env, tracing, bind, serve).
pub async fn run() -> anyhow::Result<()> {
    http_app::serve().await
}

/// Run the standalone scheduled owner-report worker service.
pub async fn run_owner_report_worker() -> anyhow::Result<()> {
    owner_report_worker::serve().await
}

/// Run the standalone expense OCR/email/card intent worker service.
pub async fn run_expense_integration_worker() -> anyhow::Result<()> {
    expense_integration_worker::serve().await
}

/// Run the standalone project payroll/calendar/e-invoice intent worker service.
pub async fn run_project_integration_worker() -> anyhow::Result<()> {
    project_integration_worker::serve().await
}

/// Run the standalone HR statutory/partner payroll integration worker service.
pub async fn run_hr_integration_worker() -> anyhow::Result<()> {
    hr_integration_worker::serve().await
}

/// Run the standalone workflow timer/outbox worker service.
pub async fn run_workflow_worker() -> anyhow::Result<()> {
    workflow_worker::serve().await
}
