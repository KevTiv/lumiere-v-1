//! Lumiere Axum API server — library surface for the `api-server` binary.

mod auth_password;
pub mod cold_tier;
mod commands;
pub mod config;
pub mod document_blob_store;
pub mod document_blobs;
mod document_render;
pub mod domain_queries;
pub mod error;
pub(crate) mod evidence_ingestion;
pub mod expense_integration_worker;
pub mod hr_integration_worker;
pub mod integration_worker;
pub mod metrics;
mod middleware;
pub mod organization_placement;
pub mod owner_report_worker;
pub mod platform_control;
mod presentation_dictionary;
mod presentation_projection;
mod presentation_reads;
pub mod project_integration_worker;
pub mod query_exec;
pub mod realtime;
pub mod reports;
pub mod routes;
mod rwanda_vsdc;
pub mod service_identity;
pub mod session;
pub mod state;
pub(crate) mod trusted_context;
pub mod web_session;
pub mod workflow_reads;
pub mod workflow_worker;

mod http_app;

/// Select the process-wide rustls provider explicitly.
///
/// The production feature graph contains both `aws-lc-rs` and `ring`; rustls
/// cannot choose between them automatically and otherwise panics on the first
/// TLS client construction.
fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

/// Run the HTTP server (env, tracing, bind, serve).
pub async fn run() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::serve().await
}

/// Run the standalone scheduled owner-report worker service.
pub async fn run_owner_report_worker() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::init_tracing();
    owner_report_worker::serve().await
}

/// Run the standalone expense OCR/email/card intent worker service.
pub async fn run_expense_integration_worker() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::init_tracing();
    expense_integration_worker::serve().await
}

/// Run the standalone bounded SpacetimeDB-to-PostgreSQL projection worker.
pub async fn run_projection_worker() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::init_tracing();
    cold_tier::projection_worker::serve().await
}

/// Apply all checksum-verified PostgreSQL storage migrations and exit.
pub async fn run_storage_migrations() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    let config = cold_tier::pg_pool::PgConfig::from_env()?;
    let pool = cold_tier::pg_pool::build_pool(&config)?;
    cold_tier::migrate::ensure_schema(&pool).await
}

/// Inspect PostgreSQL migration lineage without applying or modifying schema.
pub async fn audit_storage_migrations() -> anyhow::Result<cold_tier::migrate::MigrationAuditReport>
{
    install_rustls_crypto_provider();
    let config = cold_tier::pg_pool::PgConfig::from_env()?;
    let pool = cold_tier::pg_pool::build_pool(&config)?;
    cold_tier::migrate::audit_schema(&pool).await
}

/// Run one trusted PostgreSQL-to-SpacetimeDB organization reconstruction.
pub async fn run_organization_reconstruction(organization_id: u64) -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    let report =
        cold_tier::reconstruction::run_organization_reconstruction(organization_id).await?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

/// Run the standalone project payroll/calendar/e-invoice intent worker service.
pub async fn run_project_integration_worker() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::init_tracing();
    project_integration_worker::serve().await
}

/// Run the standalone HR statutory/partner payroll integration worker service.
pub async fn run_hr_integration_worker() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::init_tracing();
    hr_integration_worker::serve().await
}

/// Run the standalone workflow timer/outbox worker service.
pub async fn run_workflow_worker() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::init_tracing();
    workflow_worker::serve().await
}

/// Run the durable Meta inbox worker or its explicitly selected maintenance command.
pub async fn run_whatsapp_inbox_worker() -> anyhow::Result<()> {
    install_rustls_crypto_provider();
    http_app::init_tracing();
    routes::whatsapp_meta::run_worker().await
}
