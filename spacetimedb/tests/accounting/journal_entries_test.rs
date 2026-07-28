/// Journal entry / customer invoice domain tests.
use spacetimedb::ReducerContext;

use crate::accounting::journal_entries::{
    account_move, account_move_line, add_account_move_line, cancel_account_move,
    compute_invoice_totals, post_invoice, AddAccountMoveLineParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::AccountMoveState;

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
