//! Structural organization-subscription policies → generated runtime descriptors.

mod emit;

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::Result;

pub fn run(paths: &Paths, registry_text: &str) -> Result<()> {
    let policy_json = read_to_string(&paths.subscription_query_policy_json)?;
    let policy = emit::parse_and_validate(&policy_json, registry_text)?;
    write_file(&paths.erp_org_sql_rust_out, &emit::emit_manifest(&policy)?)?;
    write_file(
        &paths.org_subscription_descriptors_ts_out,
        &emit::emit_typescript(&policy)?,
    )?;

    println!(
        "lumiere-codegen: {} structural organization subscription descriptors",
        policy.resources.len(),
    );
    println!("Wrote {}", paths.erp_org_sql_rust_out.display());
    println!(
        "Wrote {}",
        paths.org_subscription_descriptors_ts_out.display()
    );

    Ok(())
}
