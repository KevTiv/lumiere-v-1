use anyhow::{bail, Context, Result};

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let organization_id = args
        .next()
        .context("usage: c7-coverage-snapshot <organization-id>")?
        .parse::<u64>()
        .context("organization id must be an unsigned integer")?;
    if args.next().is_some() {
        bail!("usage: c7-coverage-snapshot <organization-id>");
    }
    let report =
        api_server::cold_tier::reconstruction::capture_coverage_snapshot(organization_id).await?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
