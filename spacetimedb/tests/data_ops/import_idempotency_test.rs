//! COV-22: a committed import file is identified by SHA-256 and replays fail closed.

use spacetimedb::{ReducerContext, Table};

use crate::data_ops::hr_imports::import_hr_payslip_csv;
use crate::data_ops::import_tracker::{import_content_sha256, import_job};
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
    Ok(())
}
