//! Location imports retain the exact created identity and original source evidence.

use spacetimedb::ReducerContext;

use crate::core::audit::audit_log;
use crate::core::business_changes::business_change;
use crate::core::persistence::{
    organization_commit, organization_row_change, OrganizationRowChange,
};
use crate::data_ops::import_tracker::{
    import_csv_tracked, import_job, import_job_error, import_job_record, ImportCsvTrackedParams,
};
use crate::inventory::warehouse::stock_location;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_location_import_retains_source_row(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let before = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&fixture.organization_id)
        .map(|commit| commit.sequence)
        .max()
        .unwrap_or(0);
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
    let request_id = "1".repeat(32);
    import_csv_tracked(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        ImportCsvTrackedParams {
            request_id: request_id.clone(),
            entity: "stock_location".into(),
            csv_data: csv,
            file_name: Some("farm-locations.csv".into()),
            currency_id: None,
        },
    )?;
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
    let sealed: serde_json::Value = serde_json::from_str(
        job.metadata
            .as_deref()
            .ok_or("tracked import metadata missing")?,
    )
    .map_err(|error| error.to_string())?;
    if job.status != "partial"
        || sealed["correlation_version"] != 1
        || sealed["request_id"] != request_id
        || sealed["company_id"] != fixture.company_id
    {
        return Err(
            "tracked location import was not sealed with its exact request and company".into(),
        );
    }
    let private = ctx
        .db
        .business_change()
        .business_change_by_record()
        .filter((
            &fixture.organization_id,
            &trace.table_name,
            &trace.record_id,
        ))
        .find(|event| event.operation == "import_stock_location_csv")
        .ok_or("tracked location import private creation proof missing")?;
    if private.company_id != fixture.company_id || private.actor_identity != ctx.sender() {
        return Err("location creation proof lost its company or native actor".into());
    }
    let audit = ctx
        .db
        .audit_log()
        .id()
        .find(&private.audit_log_id)
        .ok_or("linked import audit missing")?;
    let receipt: serde_json::Value = serde_json::from_str(
        audit
            .metadata
            .as_deref()
            .ok_or("native row receipt missing")?,
    )
    .map_err(|error| error.to_string())?;
    if receipt["import_job_id"] != job.id.to_string() || receipt["import_row"] != 2 {
        return Err(
            "private location creation proof is not linked to the exact import job and row".into(),
        );
    }
    let commits = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&fixture.organization_id)
        .filter(|commit| commit.sequence > before)
        .collect::<Vec<_>>();
    let [commit] = commits.as_slice() else {
        return Err(
            "tracked import split source and history into separate durable outcomes".into(),
        );
    };
    if commit.operation_id != "erp.import_csv_tracked"
        || commit.correlation_id != format!("tracked-import:{}", job.id)
    {
        return Err("tracked import replaced its owning operation or exact job identity".into());
    }
    let rows = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&fixture.organization_id)
        .filter(|row| row.commit_sequence == commit.sequence)
        .collect::<Vec<_>>();
    assert_complete_row(&rows, "import_job", job.id, &job)?;
    assert_complete_row(&rows, "import_job_record", trace.id, trace)?;
    assert_complete_row(&rows, "stock_location", location.id, &location)?;
    assert_complete_row(&rows, "business_change", private.id, &private)?;
    assert_complete_row(&rows, "audit_log", audit.id, &audit)?;
    let errors = ctx
        .db
        .import_job_error()
        .import_error_by_job()
        .filter(&job.id)
        .collect::<Vec<_>>();
    let [error] = errors.as_slice() else {
        return Err("partial import must retain its one exact rejected row".into());
    };
    assert_complete_row(&rows, "import_job_error", error.id, error)?;
    let submission_id = rows
        .iter()
        .filter(|row| row.table_name == "audit_log")
        .filter_map(|row| serde_json::from_str::<serde_json::Value>(&row.row_identity_json).ok())
        .filter_map(|identity| identity["id"].as_u64())
        .find(|id| *id != audit.id)
        .ok_or("tracked import submission audit was not retained")?;
    let submission = ctx
        .db
        .audit_log()
        .id()
        .find(&submission_id)
        .ok_or("tracked import submission audit missing")?;
    if submission.organization_id != fixture.organization_id
        || submission.table_name != "import_job"
        || submission.record_id != job.id
        || submission.action != "IMPORT_SUBMIT"
        || submission.user_identity != ctx.sender()
    {
        return Err("tracked import retained an unrelated submission audit".into());
    }
    assert_complete_row(&rows, "audit_log", submission.id, &submission)?;
    if rows.len() != 7 || commit.row_change_count != 7 {
        return Err(
            "tracked import outcome omitted submission audit or added a history-only prefix".into(),
        );
    }
    Ok(())
}

fn assert_complete_row<T: spacetimedb_sats::Serialize + ?Sized>(
    rows: &[OrganizationRowChange],
    table: &str,
    id: u64,
    expected: &T,
) -> Result<(), String> {
    let mut matches = rows.iter().filter(|row| {
        row.table_name == table
            && serde_json::from_str::<serde_json::Value>(&row.row_identity_json)
                .ok()
                .is_some_and(|identity| identity["id"].as_u64() == Some(id))
    });
    let row = matches
        .next()
        .ok_or_else(|| format!("tracked import outcome omitted {table} {id}"))?;
    let actual: serde_json::Value = serde_json::from_str(
        row.row_json
            .as_deref()
            .ok_or("tracked import outcome retained a tombstone instead of its complete source")?,
    )
    .map_err(|error| error.to_string())?;
    let expected = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(expected))
        .map_err(|error| error.to_string())?;
    if matches.next().is_some() || row.change_kind != "upsert" || actual != expected {
        return Err(format!(
            "tracked import outcome did not retain one complete final {table} {id}"
        ));
    }
    Ok(())
}
