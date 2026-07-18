#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_project_integration_worker().await
}
