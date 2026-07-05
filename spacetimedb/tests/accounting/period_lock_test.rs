use spacetimedb::{ReducerContext, Table};

use crate::accounting::fiscal_periods::{
    account_period, close_account_period, create_account_period, CreateAccountPeriodParams,
};
use crate::accounting::journal_entries::post_invoice;
use crate::accounting::payments::{account_payment, create_payment, post_payment, CreatePaymentParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentState, PaymentType, PeriodState};

use super::helpers::{create_balanced_customer_invoice, seed_bank_journal};

fn seed_closed_period(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<(), String> {
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

    Ok(())
}

pub fn test_post_blocked_in_closed_period(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    seed_closed_period(ctx, &fixture)?;

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

pub fn test_post_payment_blocked_in_closed_period(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    seed_closed_period(ctx, &fixture)?;

    let (bank_journal_id, _bank_account_id) = seed_bank_journal(ctx, &fixture)?;

    create_payment(
        ctx,
        fixture.organization_id,
        CreatePaymentParams {
            company_id: fixture.company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 25.0,
            currency_id: 1,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("Period lock payment test".to_string()),
            memo: None,
        },
    )?;

    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|p| {
            p.organization_id == fixture.organization_id
                && p.ref_ == Some("Period lock payment test".to_string())
        })
        .map(|p| p.id)
        .ok_or("Payment record not found after create")?;

    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found before post")?;
    if payment.state != PaymentState::NotPaid {
        return Err("Expected draft payment before post".to_string());
    }

    let result = post_payment(ctx, fixture.organization_id, payment_id);

    match result {
        Ok(()) => Err("Expected post_payment to fail in closed accounting period".to_string()),
        Err(msg) if msg.contains("closed") => Ok(()),
        Err(msg) => Err(format!("Unexpected error: {msg}")),
    }
}
