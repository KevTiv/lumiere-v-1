#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_owner_report_worker().await
}
