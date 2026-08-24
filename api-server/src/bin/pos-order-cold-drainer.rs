#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_pos_order_cold_drainer().await
}
