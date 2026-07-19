#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_hr_integration_worker().await
}
