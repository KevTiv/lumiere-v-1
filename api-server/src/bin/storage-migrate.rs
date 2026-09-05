//! Apply the checksum-verified PostgreSQL schema and exit.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_storage_migrations().await
}
