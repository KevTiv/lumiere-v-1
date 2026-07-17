#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_expense_integration_worker().await
}
