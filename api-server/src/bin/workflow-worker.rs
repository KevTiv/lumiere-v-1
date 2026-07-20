#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_workflow_worker().await
}
