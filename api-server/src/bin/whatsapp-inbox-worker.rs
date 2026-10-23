//! Explicitly configured Meta inbox worker; see the WhatsApp alpha runbook.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    api_server::run_whatsapp_inbox_worker().await
}
