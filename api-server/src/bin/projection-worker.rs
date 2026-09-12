#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_projection_worker().await
}
