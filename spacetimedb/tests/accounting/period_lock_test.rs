use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::fiscal_periods::{
    account_fiscal_year, account_period, accounting_ownership_backfill_issue,
    backfill_fiscal_period_organization_ownership, close_account_period, create_account_period,
    update_fiscal_year, AccountFiscalYear, CreateAccountPeriodParams, UpdateFiscalYearParams,
};
use crate::accounting::journal_entries::post_invoice;
use crate::accounting::payments::{
    account_payment, create_payment, post_payment, CreatePaymentParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentState, PaymentType};

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
    let fiscal_year_b = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fixture_b.fiscal_year_id)
        .ok_or("organization B fiscal year missing")?;

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
        organization_id: Some(fixture_b.organization_id),
        ..fiscal_year_a
    });
    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        organization_id: None,
        ..fiscal_year_b
    });

    backfill_fiscal_period_organization_ownership(ctx)?;

    let quarantined = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fixture_a.fiscal_year_id)
        .ok_or("quarantined fiscal year missing")?;
    if quarantined.organization_id.is_some() {
        return Err("conflicting fiscal year ownership was not quarantined".to_string());
    }
    if !ctx
        .db
        .accounting_ownership_backfill_issue()
        .iter()
        .any(|issue| {
            issue.table_name == "account_fiscal_year" && issue.record_id == fixture_a.fiscal_year_id
        })
    {
        return Err("conflicting fiscal year ownership was not reported".to_string());
    }

    let backfilled = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fixture_b.fiscal_year_id)
        .ok_or("backfilled fiscal year missing")?;
    if backfilled.organization_id != Some(fixture_b.organization_id) {
        return Err("missing fiscal year ownership was not derived from company".to_string());
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
    create_account_period(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountPeriodParams {
            name: "Closed test period".to_string(),
            code: "CL01".to_string(),
            date_from: ctx.timestamp,
            date_to: ctx.timestamp + Duration::from_secs(86_400),
            fiscal_year_id: fixture.fiscal_year_id,
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
            idempotency_key: "period-lock-payment-test".to_string(),
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
