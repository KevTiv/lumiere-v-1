use spacetimedb::{ReducerContext, Table};

use crate::accounting::fiscal_periods::{
    account_fiscal_year, account_period, backfill_fiscal_period_organization_ownership,
    close_account_period, update_fiscal_year, AccountFiscalYear, UpdateFiscalYearParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line, post_invoice};
use crate::accounting::payments::{
    account_payment, create_payment, post_payment, CreatePaymentParams,
};
use crate::core::organization::company;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{AccountMoveState, PartnerType, PaymentState, PaymentType};

use super::helpers::{create_balanced_customer_invoice, seed_bank_journal};

pub fn test_fiscal_ownership_is_derived_and_tenant_scoped(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let fiscal_year_a = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fixture_a.fiscal_year_id)
        .ok_or("organization A fiscal year missing")?;
    let cross_tenant_update = update_fiscal_year(
        ctx,
        fixture_b.organization_id,
        fixture_b.company_id,
        fiscal_year_a.id,
        UpdateFiscalYearParams {
            name: Some("cross-tenant overwrite".to_string()),
            date_from: None,
            date_to: None,
            type_: None,
            carry_over_accounts: None,
            closing_move_id: None,
            opening_move_id: None,
            is_adjustment: None,
            notes: None,
            metadata: None,
        },
    );
    match cross_tenant_update {
        Err(error) if error.contains("organization") => {}
        Err(error) => return Err(format!("unexpected cross-tenant update error: {error}")),
        Ok(()) => return Err("cross-tenant fiscal year update succeeded".to_string()),
    }

    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        organization_id: fixture_b.organization_id,
        ..fiscal_year_a
    });
    if backfill_fiscal_period_organization_ownership(ctx).is_ok() {
        return Err("conflicting fiscal year ownership was accepted".to_string());
    }

    let quarantined_update = update_fiscal_year(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        fixture_a.fiscal_year_id,
        UpdateFiscalYearParams {
            name: Some("must remain quarantined".to_string()),
            date_from: None,
            date_to: None,
            type_: None,
            carry_over_accounts: None,
            closing_move_id: None,
            opening_move_id: None,
            is_adjustment: None,
            notes: None,
            metadata: None,
        },
    );
    if quarantined_update.is_ok() {
        return Err("quarantined fiscal year remained mutable".to_string());
    }

    Ok(())
}

fn seed_closed_period(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<(), String> {
    let period_id = ctx
        .db
        .account_period()
        .period_by_fiscal_year()
        .filter(&fixture.fiscal_year_id)
        .find(|period| period.organization_id == fixture.organization_id)
        .map(|p| p.id)
        .ok_or("Fixture period not found")?;

    close_account_period(ctx, fixture.organization_id, fixture.company_id, period_id)?;

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
    let move_before = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice move not found before post")?;
    if move_before.state != AccountMoveState::Draft {
        return Err("Expected draft invoice before post".to_string());
    }
    let line_count_before = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();

    let result = post_invoice(
        ctx,
        fixture.organization_id,
        move_id,
        revenue_id,
        revenue_id,
    );

    match result {
        Ok(()) => return Err("Expected post to fail in closed accounting period".to_string()),
        Err(msg) if msg.contains("closed") => {}
        Err(msg) => return Err(format!("Unexpected error: {msg}")),
    }

    let move_after = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice move disappeared after rejected post")?;
    let line_count_after = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();
    if move_after.state != move_before.state
        || move_after.posted_before != move_before.posted_before
        || move_after.secure_sequence_number != move_before.secure_sequence_number
        || line_count_after != line_count_before
    {
        return Err("Rejected invoice post changed persisted accounting state".to_string());
    }

    Ok(())
}

pub fn test_post_payment_blocked_in_closed_period(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    seed_closed_period(ctx, &fixture)?;

    let (bank_journal_id, _bank_account_id) = seed_bank_journal(ctx, &fixture)?;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("Fixture company not found")?
        .currency_id;

    create_payment(
        ctx,
        fixture.organization_id,
        CreatePaymentParams {
            idempotency_key: "period-lock-payment-test".to_string(),
            company_id: fixture.company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 25.0,
            currency_id,
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
    let payment_move_count_before = ctx.db.account_move().iter().count();
    let move_id_before = payment.move_id;
    let name_before = payment.name;

    let result = post_payment(ctx, fixture.organization_id, payment_id);

    match result {
        Ok(()) => {
            return Err("Expected post_payment to fail in closed accounting period".to_string())
        }
        Err(msg) if msg.contains("closed") => {}
        Err(msg) => return Err(format!("Unexpected error: {msg}")),
    }

    let payment_after = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment disappeared after rejected post")?;
    if payment_after.state != PaymentState::NotPaid
        || payment_after.move_id != move_id_before
        || payment_after.name != name_before
        || ctx.db.account_move().iter().count() != payment_move_count_before
    {
        return Err("Rejected payment post changed persisted accounting state".to_string());
    }

    Ok(())
}
