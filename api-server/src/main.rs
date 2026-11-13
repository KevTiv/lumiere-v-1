//! `api-server` binary entrypoint.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_command(std::env::args().skip(1).collect()).await
}
