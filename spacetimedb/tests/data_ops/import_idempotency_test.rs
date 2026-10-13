//! COV-22: a committed import file is identified by SHA-256 and replays fail closed.

use spacetimedb::{ReducerContext, Table};

use crate::data_ops::hr_imports::import_hr_payslip_csv;
use crate::data_ops::import_tracker::{
    import_content_sha256, import_job, import_job_error,
};
use crate::hr::payroll::hr_payslip;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn payslip_count(ctx: &ReducerContext, organization_id: u64) -> usize {
    ctx.db
        .hr_payslip()
        .iter()
        .filter(|slip| slip.organization_id == organization_id)
        .count()
}

fn job_count(ctx: &ReducerContext, organization_id: u64) -> usize {
    ctx.db
        .import_job()
        .import_job_by_org()
        .filter(&organization_id)
        .filter(|job| job.table_name == "hr_payslip")
        .count()
}

pub fn test_payslip_import_replay_is_rejected_by_file_hash(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let file = "employee_id,struct_id,name,basic_wage\n1,1,COV22 Slip A,1000".to_string();

    import_hr_payslip_csv(ctx, org, file.clone())?;
    if payslip_count(ctx, org) != 1 || job_count(ctx, org) != 1 {
        return Err("first import must create exactly one payslip and one job".to_string());
    }
    let job = ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&org)
        .find(|job| job.table_name == "hr_payslip")
        .ok_or("import job missing")?;
    let expected = serde_json::json!({ "sha256": import_content_sha256(&file) }).to_string();
    if job.status != "success" || job.metadata.as_deref() != Some(expected.as_str()) {
        return Err(format!(
            "job must be success and carry the file hash, got {} / {:?}",
            job.status, job.metadata
        ));
    }

    if import_hr_payslip_csv(ctx, org, file.clone()).is_ok() {
        return Err("replay of a committed file must be rejected".to_string());
    }
    if payslip_count(ctx, org) != 1 || job_count(ctx, org) != 1 {
        return Err("rejected replay must leave payslips and jobs unchanged".to_string());
    }

    // A different file is a different identity.
    import_hr_payslip_csv(
        ctx,
        org,
        "employee_id,struct_id,name,basic_wage\n1,1,COV22 Slip B,1000".to_string(),
    )?;
    if payslip_count(ctx, org) != 2 {
        return Err("a changed file must import".to_string());
    }

    // Another organization may import the same bytes.
    let other = OrgFixture::seed_minimal(ctx)?;
    import_hr_payslip_csv(ctx, other.organization_id, file)?;
    if payslip_count(ctx, other.organization_id) != 1 {
        return Err("hash identity must be scoped per organization".to_string());
    }

    // A file that imported nothing does not burn its identity.
    let bad = "employee_id,struct_id\n0,0".to_string();
    import_hr_payslip_csv(ctx, org, bad.clone())?;
    import_hr_payslip_csv(ctx, org, bad)
        .map_err(|e| format!("a fully failed import must stay retryable: {e}"))?;

    // Malformed and locale-formatted money must fail closed instead of silently
    // committing a zero-valued payslip. Each attempt remains an exact, hashed
    // failed job with a field-level error and no imported row.
    for (suffix, value, expected_error) in [
        ("malformed", "not-money", "valid dot-decimal"),
        ("locale", "1.234,56", "without locale grouping"),
        ("non-finite", "NaN", "finite number"),
    ] {
        let file = format!(
            "employee_id,struct_id,name,basic_wage\n1,1,COV22 {suffix},\"{value}\""
        );
        let jobs_before = job_count(ctx, org);
        let slips_before = payslip_count(ctx, org);
        import_hr_payslip_csv(ctx, org, file.clone())?;
        if payslip_count(ctx, org) != slips_before {
            return Err(format!("{suffix} money must not create a payslip"));
        }
        if job_count(ctx, org) != jobs_before + 1 {
            return Err(format!("{suffix} money must create exactly one failed job"));
        }
        let expected_hash =
            serde_json::json!({ "sha256": import_content_sha256(&file) }).to_string();
        let failed_job = ctx
            .db
            .import_job()
            .import_job_by_org()
            .filter(&org)
            .find(|job| {
                job.table_name == "hr_payslip"
                    && job.status == "failed"
                    && job.metadata.as_deref() == Some(expected_hash.as_str())
            })
            .ok_or_else(|| format!("{suffix} attempt must retain its exact failed job hash"))?;
        let field_error = ctx
            .db
            .import_job_error()
            .import_error_by_job()
            .filter(&failed_job.id)
            .find(|error| error.field_name.as_deref() == Some("basic_wage"))
            .ok_or_else(|| format!("{suffix} attempt must record a basic_wage error"))?;
        if field_error.raw_value.as_deref() != Some(value)
            || !field_error.error_message.contains(expected_error)
        {
            return Err(format!(
                "{suffix} field error lost its exact raw value or reason: {:?} / {}",
                field_error.raw_value, field_error.error_message
            ));
        }
    }

    let unquoted_locale =
        "employee_id,struct_id,name,basic_wage\n1,1,COV22 unquoted locale,1.234,56".to_string();
    let jobs_before = job_count(ctx, org);
    let slips_before = payslip_count(ctx, org);
    import_hr_payslip_csv(ctx, org, unquoted_locale.clone())?;
    if payslip_count(ctx, org) != slips_before || job_count(ctx, org) != jobs_before + 1 {
        return Err("unquoted locale money must create one failed job and no payslip".to_string());
    }
    let unquoted_hash =
        serde_json::json!({ "sha256": import_content_sha256(&unquoted_locale) }).to_string();
    let unquoted_job = ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&org)
        .find(|job| job.metadata.as_deref() == Some(unquoted_hash.as_str()))
        .ok_or("unquoted locale attempt must retain its exact failed job hash")?;
    let structural_error = ctx
        .db
        .import_job_error()
        .import_error_by_job()
        .filter(&unquoted_job.id)
        .next()
        .ok_or("unquoted locale attempt must record a structural row error")?;
    if !structural_error.error_message.contains("column count") {
        return Err("unquoted locale row did not report its column mismatch".to_string());
    }

    // Structural errors are rejected before creating a job, so they cannot
    // leave a misleading pending/failed import identity behind.
    let jobs_before = job_count(ctx, org);
    let missing_header = "employee_id,name\n1,COV22 missing structure".to_string();
    if import_hr_payslip_csv(ctx, org, missing_header).is_ok() {
        return Err("missing required headers must reject the import".to_string());
    }
    if job_count(ctx, org) != jobs_before {
        return Err("structurally invalid CSV must not create an import job".to_string());
    }
    Ok(())
}
