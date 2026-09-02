//! C0 scheduler ownership tests for tax deadline status jobs.

use spacetimedb::ReducerContext;

use crate::accounting::tax_management::{schedule_tax_deadline_updates, tax_deadline_status_job};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

/// Scheduling is per organization and replacing a schedule must not create a
/// second row or overwrite another organization's schedule.
pub fn test_tax_deadline_status_jobs_are_org_scoped_and_idempotent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let first = OrgFixture::seed_minimal(ctx)?;
    let second = OrgFixture::seed_minimal(ctx)?;

    schedule_tax_deadline_updates(ctx, first.organization_id)?;
    schedule_tax_deadline_updates(ctx, second.organization_id)?;

    let first_job = ctx
        .db
        .tax_deadline_status_job()
        .organization_id()
        .find(&first.organization_id)
        .ok_or("first organization scheduler row missing")?;
    let second_job = ctx
        .db
        .tax_deadline_status_job()
        .organization_id()
        .find(&second.organization_id)
        .ok_or("second organization scheduler row missing")?;
    if first_job.organization_id != first.organization_id
        || second_job.organization_id != second.organization_id
    {
        return Err("scheduler row organization ownership mismatch".to_string());
    }

    schedule_tax_deadline_updates(ctx, first.organization_id)?;
    let first_job = ctx
        .db
        .tax_deadline_status_job()
        .organization_id()
        .find(&first.organization_id)
        .ok_or("first organization scheduler row missing after reschedule")?;
    let second_job = ctx
        .db
        .tax_deadline_status_job()
        .organization_id()
        .find(&second.organization_id)
        .ok_or("second organization scheduler row missing after reschedule")?;
    if first_job.scheduled_id == second_job.scheduled_id {
        return Err("organization scheduler rows must have distinct primary keys".to_string());
    }

    Ok(())
}
