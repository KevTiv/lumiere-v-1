//! Lumiere Axum API server — library surface for the `api-server` binary.

mod auth_password;
pub mod cold_tier;
pub mod config;
pub mod document_blobs;
pub mod domain_queries;
pub mod error;
pub mod expense_integration_worker;
pub mod hr_integration_worker;
pub mod metrics;
mod middleware;
pub mod organization_placement;
pub mod owner_report_worker;
pub mod platform_control;
pub mod project_integration_worker;
pub mod query_exec;
pub mod realtime;
pub mod reports;
pub mod routes;
pub mod session;
pub mod state;
pub mod web_session;
pub mod workflow_reads;
pub mod workflow_worker;

mod http_app;

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

/// Run the standalone audit-log cold-tier drainer service.
pub async fn run_audit_cold_drainer() -> anyhow::Result<()> {
    cold_tier::audit_drainer::serve().await
}

/// Run the standalone pos-order cold-tier drainer service.
pub async fn run_pos_order_cold_drainer() -> anyhow::Result<()> {
    cold_tier::pos_order_drainer::serve().await
}

/// Run the standalone bounded SpacetimeDB-to-PostgreSQL projection worker.
pub async fn run_projection_worker() -> anyhow::Result<()> {
    cold_tier::projection_worker::serve().await
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
