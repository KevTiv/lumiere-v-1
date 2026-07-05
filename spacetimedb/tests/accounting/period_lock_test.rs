use spacetimedb::{ReducerContext, Table};

use crate::accounting::fiscal_periods::{
    account_period, close_account_period, create_account_period, CreateAccountPeriodParams,
};
use crate::accounting::journal_entries::post_invoice;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::PeriodState;

use super::helpers::create_balanced_customer_invoice;

pub fn test_post_blocked_in_closed_period(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_account_period(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountPeriodParams {
            name: "Closed test period".to_string(),
            code: "CL01".to_string(),
            date_from: ctx.timestamp,
            date_to: ctx.timestamp,
            fiscal_year_id: fixture.fiscal_year_id,
            state: PeriodState::Open,
            is_adjustment: false,
            notes: None,
            metadata: None,
        },
    )?;

    let period_id = ctx
        .db
        .account_period()
        .iter()
        .find(|p| p.company_id == fixture.company_id && p.code == "CL01")
        .map(|p| p.id)
        .ok_or("Period not found after create")?;

    close_account_period(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        period_id,
    )?;

    let move_id = create_balanced_customer_invoice(ctx, &fixture, 50.0, false)?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(crate::test_harness::chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;

    let result = post_invoice(
        ctx,
        fixture.organization_id,
        move_id,
        revenue_id,
        revenue_id,
    );

    match result {
        Ok(()) => Err("Expected post to fail in closed accounting period".to_string()),
        Err(msg) if msg.contains("closed") => Ok(()),
        Err(msg) => Err(format!("Unexpected error: {msg}")),
    }
}
