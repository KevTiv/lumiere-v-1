//! `api-server` binary entrypoint.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run().await
}
