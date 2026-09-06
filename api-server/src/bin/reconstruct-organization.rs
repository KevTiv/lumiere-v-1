use anyhow::{bail, Context, Result};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let mut args = std::env::args().skip(1);
    let organization_id = args
        .next()
        .context("usage: reconstruct-organization <organization-id>")?
        .parse::<u64>()
        .context("organization id must be an unsigned integer")?;
    if args.next().is_some() {
        bail!("usage: reconstruct-organization <organization-id>");
    }
    api_server::run_organization_reconstruction(organization_id).await
}
