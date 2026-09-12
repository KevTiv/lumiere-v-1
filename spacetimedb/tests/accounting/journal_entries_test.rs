/// Journal entry / customer invoice domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::{
    account_move, account_move_line, add_account_move_line, cancel_account_move,
    compute_invoice_totals, create_credit_note_from_invoice, post_invoice,
    AddAccountMoveLineParams, CreateCreditNoteParams,
};
use crate::accounting::tax_management::{account_tax, create_account_tax, CreateAccountTaxParams};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountMoveState, TaxAmountType, TaxTypeUse};

use super::helpers::create_balanced_customer_invoice;

pub fn test_post_customer_invoice_creates_move_lines(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let amount = 100.0;

    let move_id = create_balanced_customer_invoice(ctx, &fixture, amount, true)?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Posted invoice move not found")?;

    if move_record.state != AccountMoveState::Posted {
        return Err(format!(
            "Expected Posted invoice state, got {:?}",
            move_record.state
        ));
    }

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    if lines.len() < 2 {
        return Err(format!(
            "Expected at least 2 move lines after post, got {}",
            lines.len()
        ));
    }

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() > 0.01 {
        return Err(format!(
            "Move lines not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    if (total_debit - amount).abs() > 0.01 {
        return Err(format!("Expected total debit ~{amount}, got {total_debit}"));
    }

    Ok(())
}

pub fn test_cross_tenant_move_mutations_fail_closed(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let move_id = create_balanced_customer_invoice(ctx, &fixture_a, 137.0, false)?;
    let revenue_id = *fixture_a
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("harness missing revenue account")?;
    let before = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("draft invoice missing")?;
    let line_count = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();

    let add_result = add_account_move_line(
        ctx,
        fixture_b.organization_id,
        move_id,
        AddAccountMoveLineParams {
            account_id: revenue_id,
            name: "cross-tenant line".to_string(),
            debit: 1.0,
            credit: 0.0,
            sequence: 99,
            quantity: 1.0,
            price_unit: 1.0,
            discount: 0.0,
            tax_ids: vec![],
            partner_id: Some(fixture_a.partner_id),
            product_id: None,
            product_uom_id: None,
            product_category_id: None,
            analytic_account_id: None,
            analytic_tag_ids: vec![],
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: false,
            blocked: false,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_repartition_line_id: None,
            tax_audit: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            matching_number: None,
            matching_label: None,
            expected_pay_date: None,
            expected_pay_date_currency_id: None,
            expected_pay_date_amount: 0.0,
            expected_pay_date_residual: 0.0,
            metadata: None,
        },
    );
    let compute_result = compute_invoice_totals(ctx, fixture_b.organization_id, move_id);
    let post_result = post_invoice(
        ctx,
        fixture_b.organization_id,
        move_id,
        revenue_id,
        revenue_id,
    );
    let cancel_result = cancel_account_move(ctx, fixture_b.organization_id, move_id);

    for (action, result) in [
        ("add", add_result),
        ("compute", compute_result),
        ("post", post_result),
        ("cancel", cancel_result),
    ] {
        match result {
            Err(error) if error.contains("organization") => {}
            Err(error) => return Err(format!("unexpected cross-tenant {action} error: {error}")),
            Ok(()) => return Err(format!("cross-tenant {action} mutation succeeded")),
        }
    }

    let after = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("draft invoice missing after rejected mutations")?;
    let after_line_count = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();
    if after.state != before.state
        || after.amount_total != before.amount_total
        || after.amount_residual != before.amount_residual
        || after_line_count != line_count
    {
        return Err("rejected cross-tenant move mutation changed persisted data".to_string());
    }

    Ok(())
}

/// ACC-RI-024: `create_credit_note_from_invoice` must reject a source invoice
/// belonging to a different organization than the caller, even when the
/// caller supplies the invoice's real `company_id`, and must not create a
/// credit note as a side effect of the rejected call.
pub fn test_create_credit_note_rejects_cross_tenant_invoice(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let invoice_a = create_balanced_customer_invoice(ctx, &fixture_a, 250.0, true)?;

    let before_count = ctx.db.account_move().iter().count();

    let cross_tenant_result = create_credit_note_from_invoice(
        ctx,
        fixture_b.organization_id,
        fixture_a.company_id,
        invoice_a,
        CreateCreditNoteParams {
            line_ids: vec![],
            reason: Some("cross-tenant probe".to_string()),
        },
    );
    if cross_tenant_result.is_ok() {
        return Err(
            "create_credit_note_from_invoice accepted a cross-organization invoice".to_string(),
        );
    }

    let after_count = ctx.db.account_move().iter().count();
    if after_count != before_count {
        return Err(
            "rejected cross-tenant credit-note create still persisted a new move".to_string(),
        );
    }

    // Positive: same-tenant credit note creation still succeeds.
    create_credit_note_from_invoice(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        invoice_a,
        CreateCreditNoteParams {
            line_ids: vec![],
            reason: Some("same-tenant correction".to_string()),
        },
    )?;
    let after_positive_count = ctx.db.account_move().iter().count();
    if after_positive_count != before_count + 1 {
        return Err("same-tenant credit-note create did not persist a new move".to_string());
    }

    Ok(())
}

fn probe_tax_params(name: &str) -> CreateAccountTaxParams {
    CreateAccountTaxParams {
        name: name.to_string(),
        description: None,
        type_tax_use: TaxTypeUse::Sale,
        amount_type: TaxAmountType::Percent,
        amount: 8.5,
        active: true,
        price_include: false,
        include_base_amount: false,
        is_base_affected: true,
        sequence: 10,
        tax_group_id: None,
        country_id: None,
        country_code: None,
        tags: vec![],
        has_negative_factor: false,
        invoice_repartition_line_ids: vec![],
        refund_repartition_line_ids: vec![],
        metadata: Some(r#"{"test":"acc_004_tax_id_validation"}"#.to_string()),
    }
}

fn find_tax_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: &str,
) -> Result<u64, String> {
    ctx.db
        .account_tax()
        .iter()
        .find(|t| {
            t.organization_id == organization_id && t.company_id == company_id && t.name == name
        })
        .map(|t| t.id)
        .ok_or_else(|| "probe tax not found after create".to_string())
}

fn tax_probe_line_params(
    account_id: u64,
    partner_id: u64,
    tax_ids: Vec<u64>,
) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name: "ACC-004 tax probe".to_string(),
        debit: 0.0,
        credit: 1.0,
        sequence: 99,
        quantity: 1.0,
        price_unit: 1.0,
        discount: 0.0,
        tax_ids,
        partner_id: Some(partner_id),
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: false,
        blocked: false,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_repartition_line_id: None,
        tax_audit: None,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        matching_number: None,
        matching_label: None,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        metadata: None,
    }
}

/// ACC-004: `add_account_move_line` must reject a `tax_ids` entry that does not
/// exist in `account_tax`, and must also reject a real tax that belongs to a
/// different organization — neither rejected call may persist a move line.
/// A real, same-organization tax is still accepted.
pub fn test_add_account_move_line_rejects_invalid_and_cross_org_tax_id(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let revenue_id = *fixture_a
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("harness missing revenue account")?;

    // A real tax that belongs to a *different* organization than the move.
    let cross_org_tax_name = format!("ACC-004 cross-org tax {}", fixture_b.company_id);
    create_account_tax(
        ctx,
        fixture_b.organization_id,
        fixture_b.company_id,
        probe_tax_params(&cross_org_tax_name),
    )?;
    let cross_org_tax_id = find_tax_id(
        ctx,
        fixture_b.organization_id,
        fixture_b.company_id,
        &cross_org_tax_name,
    )?;

    // A real, same-organization tax that should be accepted.
    let same_org_tax_name = format!("ACC-004 same-org tax {}", fixture_a.company_id);
    create_account_tax(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        probe_tax_params(&same_org_tax_name),
    )?;
    let same_org_tax_id = find_tax_id(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        &same_org_tax_name,
    )?;

    let move_id = create_balanced_customer_invoice(ctx, &fixture_a, 42.0, false)?;
    let line_count_before = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();

    // Case 1: tax_id that does not exist in account_tax at all.
    let nonexistent_result = add_account_move_line(
        ctx,
        fixture_a.organization_id,
        move_id,
        tax_probe_line_params(revenue_id, fixture_a.partner_id, vec![u64::MAX]),
    );
    match nonexistent_result {
        Err(error) if error.contains("not found") => {}
        Err(error) => return Err(format!("unexpected error for nonexistent tax_id: {error}")),
        Ok(()) => return Err("add_account_move_line accepted a nonexistent tax_id".to_string()),
    }

    // Case 2: tax_id exists but belongs to a different organization.
    let cross_org_result = add_account_move_line(
        ctx,
        fixture_a.organization_id,
        move_id,
        tax_probe_line_params(revenue_id, fixture_a.partner_id, vec![cross_org_tax_id]),
    );
    match cross_org_result {
        Err(error) if error.contains("organization") => {}
        Err(error) => {
            return Err(format!(
                "unexpected error for cross-organization tax_id: {error}"
            ))
        }
        Ok(()) => {
            return Err("add_account_move_line accepted a cross-organization tax_id".to_string())
        }
    }

    let line_count_after_rejections = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();
    if line_count_after_rejections != line_count_before {
        return Err("rejected tax_id validation still persisted a move line".to_string());
    }

    // Positive: a real, same-organization tax is accepted and the line persists.
    add_account_move_line(
        ctx,
        fixture_a.organization_id,
        move_id,
        tax_probe_line_params(revenue_id, fixture_a.partner_id, vec![same_org_tax_id]),
    )?;
    let line_count_after_accept = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();
    if line_count_after_accept != line_count_before + 1 {
        return Err("valid same-organization tax_id line was not persisted".to_string());
    }

    Ok(())
}
