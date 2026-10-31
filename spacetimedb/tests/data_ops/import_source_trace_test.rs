//! Location imports retain the exact created identity and original source evidence.

use spacetimedb::{ReducerContext, Table};

use crate::data_ops::import_tracker::{import_job, import_job_record};
use crate::data_ops::inventory_imports::import_stock_location_csv;
use crate::inventory::stock::stock_location;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_location_import_retains_source_row(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let evidence = serde_json::json!({"source_review": {
        "version": 1, "batch_id": "7", "item_id": "81", "revision": 3,
        "source_file": "farm-locations.csv", "source_row": 42,
        "source_sha256": "a".repeat(64), "row_basis": "source_line",
        "decision_reason": "Confirmed farm location with source owner"
    }})
    .to_string();
    let csv = format!(
        "name,usage,active,metadata\nFarm store,internal,true,\"{}\"\n,internal,true,",
        evidence.replace('"', "\"\"")
    );
    import_stock_location_csv(ctx, fixture.organization_id, fixture.company_id, csv)?;
    let job = ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&fixture.organization_id)
        .filter(|job| job.table_name == "stock_location")
        .max_by_key(|job| job.id)
        .ok_or("location import job missing")?;
    let created: Vec<_> = ctx
        .db
        .import_job_record()
        .import_record_by_job()
        .filter(&job.id)
        .collect();
    if job.imported_rows != 1 || job.error_rows != 1 || created.len() != 1 {
        return Err("the import must record only the successfully created location".into());
    }
    let trace = &created[0];
    if trace.organization_id != fixture.organization_id
        || trace.table_name != "stock_location"
        || trace.row_number != 2
    {
        return Err("location import trace has the wrong scope or submitted row".into());
    }
    let location = ctx
        .db
        .stock_location()
        .id()
        .find(&trace.record_id)
        .ok_or("exact imported location missing")?;
    if location.company_id != Some(fixture.company_id)
        || location.metadata.as_deref() != Some(evidence.as_str())
    {
        return Err("location import must retain the original file and row evidence".into());
    }
    Ok(())
}
