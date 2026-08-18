#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_audit_cold_drainer().await
}
