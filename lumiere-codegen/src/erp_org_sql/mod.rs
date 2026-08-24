//! ERP org-subscription SQL pipeline: `erp-subscriptions.ts` → `erp-org-sql.json`,
//! cross-checked against the resource registry so every ERP org-scoped query
//! resource has a matching registry entry.

mod emit;

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::Result;

pub fn run(paths: &Paths, registry_text: &str) -> Result<()> {
    let erp_subs_ts = read_to_string(&paths.erp_subscriptions_ts)?;
    let erp_org_rows = emit::parse_erp_org_sql(&erp_subs_ts)?;

    let registry_keys = emit::registry_keys(registry_text).map_err(|e| anyhow::anyhow!(e))?;
    for row in &erp_org_rows {
        if !registry_keys.contains_key(&row.resource_key) {
            anyhow::bail!(
                "erp-org-sql resource \"{}\" (map key \"{}\") missing from resource_registry.json",
                row.resource_key,
                row.map_key
            );
        }
    }

    let erp_org_json = emit::emit_erp_org_sql_json(&erp_subs_ts)?;
    write_file(&paths.erp_org_sql_rust_out, &erp_org_json)?;

    println!(
        "lumiere-codegen: {} ERP org subscription rows from {}",
        erp_org_rows.len(),
        paths.erp_subscriptions_ts.display()
    );
    println!("Wrote {}", paths.erp_org_sql_rust_out.display());

    Ok(())
}
