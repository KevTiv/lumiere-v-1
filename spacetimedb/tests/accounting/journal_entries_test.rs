/// Journal entry / customer invoice domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_journal, create_account_account, create_account_journal,
    CreateAccountAccountParams, CreateAccountJournalParams,
};
use crate::accounting::idempotency::accounting_operation_receipt;
use crate::accounting::journal_entries::{
    account_move, account_move_line, add_account_move_line, cancel_account_move,
    compute_invoice_totals, create_credit_note_from_invoice, create_manual_invoice, post_invoice,
    reset_account_move_to_draft, AddAccountMoveLineParams, CreateCreditNoteParams,
    CreateManualInvoiceParams, ManualInvoiceLineParams,
};
use crate::accounting::tax_management::{
    account_tax, account_tax_group, create_account_tax, create_account_tax_group,
    CreateAccountTaxGroupParams, CreateAccountTaxParams,
};
use crate::core::organization::company;
use crate::core::reference::currency;
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountMoveState, JournalType, MoveType, PaymentState, TaxAmountType,
    TaxTypeUse,
};

use super::helpers::{
    create_balanced_customer_invoice, create_balanced_customer_invoice_on_account,
};

fn seed_manual_invoice_sales_journal(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    currency_id: u64,
    label: &str,
) -> Result<(u64, u64), String> {
    let revenue_id = fixture.chart_account_ids[chart_keys::REVENUE];
    let code = format!("MI{label}{}", fixture.company_id);
    create_account_journal(
        ctx,
        fixture.organization_id,
        CreateAccountJournalParams {
            company_id: Some(fixture.company_id),
            name: "Manual Invoice Sales".to_string(),
            code: code.clone(),
            type_: JournalType::Sale,
            currency_id: Some(currency_id),
            default_account_id: Some(revenue_id),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: None,
            payment_credit_account_id: None,
            payment_debit_account_id: None,
            invoice_reference_type: None,
            invoice_reference_model: None,
            sequence_id: None,
            refund_sequence_id: None,
            sequence_override_regex: None,
            secure_sequence_id: None,
            alias_name: None,
            alias_domain: None,
            sale_activity_type_id: None,
            sale_activity_user_id: None,
            sale_activity_note: None,
            sale_activity_date_deadline: None,
            restrict_mode_hash_table: false,
            active: true,
            at_least_one_inbound: true,
            at_least_one_outbound: true,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: None,
        },
    )?;
    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|journal| journal.organization_id == fixture.organization_id && journal.code == code)
        .map(|journal| journal.id)
        .ok_or("manual invoice test journal missing")?;
    Ok((journal_id, currency_id))
}

fn seed_manual_invoice_tax(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    label: &str,
    with_posting_account: bool,
) -> Result<u64, String> {
    let posting_accounts = if with_posting_account {
        let ap = ctx
            .db
            .account_account()
            .id()
            .find(&fixture.chart_account_ids[chart_keys::AP])
            .ok_or("manual invoice AP account missing")?;
        let ar = ctx
            .db
            .account_account()
            .id()
            .find(&fixture.chart_account_ids[chart_keys::AR])
            .ok_or("manual invoice AR account missing")?;
        let payable_code = format!("TAXP{label}{}", fixture.company_id);
        let receivable_code = format!("TAXR{label}{}", fixture.company_id);
        for (code, name, user_type_id, internal_group) in [
            (
                payable_code.clone(),
                "Tax payable",
                ap.user_type_id,
                AccountInternalGroup::Liability,
            ),
            (
                receivable_code.clone(),
                "Tax receivable",
                ar.user_type_id,
                AccountInternalGroup::Asset,
            ),
        ] {
            create_account_account(
                ctx,
                fixture.organization_id,
                CreateAccountAccountParams {
                    company_id: Some(fixture.company_id),
                    code,
                    name: name.to_string(),
                    user_type_id,
                    currency_id: None,
                    internal_type: None,
                    internal_group: Some(internal_group),
                    group_id: None,
                    reconcile: false,
                    tax_ids: vec![],
                    note: None,
                    opening_debit: 0.0,
                    opening_credit: 0.0,
                    allowed_journal_ids: vec![],
                    non_trade: false,
                    is_off_balance: false,
                    metadata: None,
                },
            )?;
        }
        let payable_id = ctx
            .db
            .account_account()
            .iter()
            .find(|account| {
                account.organization_id == fixture.organization_id
                    && account.company_id == fixture.company_id
                    && account.code == payable_code
            })
            .map(|account| account.id)
            .ok_or("manual invoice tax payable account missing")?;
        let receivable_id = ctx
            .db
            .account_account()
            .iter()
            .find(|account| {
                account.organization_id == fixture.organization_id
                    && account.company_id == fixture.company_id
                    && account.code == receivable_code
            })
            .map(|account| account.id)
            .ok_or("manual invoice tax receivable account missing")?;
        Some((payable_id, receivable_id))
    } else {
        None
    };
    let group_name = format!("Manual invoice {label} group {}", fixture.company_id);
    create_account_tax_group(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxGroupParams {
            name: group_name.clone(),
            sequence: 10,
            preceding_subtotal: None,
            tax_payable_account_id: posting_accounts.map(|accounts| accounts.0),
            tax_receivable_account_id: posting_accounts.map(|accounts| accounts.1),
            advance_tax_payment_account_id: None,
            metadata: None,
        },
    )?;
    let group_id = ctx
        .db
        .account_tax_group()
        .iter()
        .find(|group| {
            group.organization_id == fixture.organization_id
                && group.company_id == fixture.company_id
                && group.name == group_name
        })
        .map(|group| group.id)
        .ok_or("manual invoice tax group missing")?;
    let tax_name = format!("Manual invoice {label} 8% {}", fixture.company_id);
    create_account_tax(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxParams {
            name: tax_name.clone(),
            description: None,
            type_tax_use: TaxTypeUse::Sale,
            amount_type: TaxAmountType::Percent,
            amount: 8.0,
            active: true,
            price_include: false,
            include_base_amount: false,
            is_base_affected: true,
            sequence: 10,
            tax_group_id: Some(group_id),
            country_id: None,
            country_code: None,
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            metadata: None,
        },
    )?;
    ctx.db
        .account_tax()
        .iter()
        .find(|tax| {
            tax.organization_id == fixture.organization_id
                && tax.company_id == fixture.company_id
                && tax.name == tax_name
        })
        .map(|tax| tax.id)
        .ok_or_else(|| "manual invoice tax missing".to_string())
}

pub fn test_manual_invoice_is_atomic_balanced_and_idempotent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("manual invoice test company missing")?
        .currency_id;
    let (journal_id, currency_id) =
        seed_manual_invoice_sales_journal(ctx, &fixture, currency_id, "BASE")?;
    let revenue_id = fixture.chart_account_ids[chart_keys::REVENUE];
    let revenue = ctx
        .db
        .account_account()
        .id()
        .find(&revenue_id)
        .ok_or("manual invoice revenue account missing")?;
    if revenue.internal_type.is_some()
        || revenue.internal_group != Some(AccountInternalGroup::Income)
    {
        return Err(
            "manual invoice regression fixture must exercise internal-group fallback".to_string(),
        );
    }
    let user_type_only_code = format!("4010MI{}", fixture.company_id);
    create_account_account(
        ctx,
        fixture.organization_id,
        CreateAccountAccountParams {
            company_id: Some(fixture.company_id),
            code: user_type_only_code.clone(),
            name: "User-type classified revenue".to_string(),
            user_type_id: revenue.user_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: None,
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let user_type_only_revenue_id = ctx
        .db
        .account_account()
        .iter()
        .find(|account| {
            account.organization_id == fixture.organization_id
                && account.company_id == fixture.company_id
                && account.code == user_type_only_code
        })
        .map(|account| account.id)
        .ok_or("manual invoice user-type classified revenue account missing")?;
    let receivable_id = fixture.chart_account_ids[chart_keys::AR];
    let tax_id = seed_manual_invoice_tax(ctx, &fixture, "configured", true)?;
    let request_id = format!("manual-invoice-alpha:{}", fixture.company_id);
    let params = CreateManualInvoiceParams {
        idempotency_key: request_id.clone(),
        company_id: fixture.company_id,
        journal_id,
        move_type: MoveType::OutInvoice,
        currency_id,
        partner_id: fixture.partner_id,
        counterpart_account_id: receivable_id,
        date: ctx.timestamp,
        invoice_date: ctx.timestamp,
        invoice_date_due: Some(ctx.timestamp),
        ref_: Some("ALPHA-INV-001".to_string()),
        lines: vec![
            ManualInvoiceLineParams {
                account_id: revenue_id,
                name: "Fractional consulting hours".to_string(),
                quantity: 1.5,
                price_unit: 100.0,
                discount: 0.0,
                tax_ids: vec![tax_id],
            },
            ManualInvoiceLineParams {
                account_id: user_type_only_revenue_id,
                name: "Setup".to_string(),
                quantity: 1.0,
                price_unit: 50.0,
                discount: 10.0,
                tax_ids: vec![],
            },
        ],
        metadata: Some(r#"{"source":"manual-alpha"}"#.to_string()),
    };

    create_manual_invoice(ctx, fixture.organization_id, params.clone())?;
    create_manual_invoice(ctx, fixture.organization_id, params.clone())?;

    let receipt = ctx
        .db
        .accounting_operation_receipt()
        .iter()
        .find(|receipt| {
            receipt.organization_id == fixture.organization_id
                && receipt.company_id == fixture.company_id
                && receipt.action_kind == "create_manual_invoice"
                && receipt.idempotency_key == request_id
        })
        .ok_or("manual invoice receipt missing")?;
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&receipt.result_id)
        .ok_or("manual invoice result move missing")?;
    if move_record.state != AccountMoveState::Draft
        || (move_record.amount_untaxed - 195.0).abs() > 0.005
        || (move_record.amount_tax - 12.0).abs() > 0.005
        || (move_record.amount_total - 207.0).abs() > 0.005
        || (move_record.amount_residual - 207.0).abs() > 0.005
        || move_record.currency_id != currency_id
        || move_record.partner_id != Some(fixture.partner_id)
    {
        return Err("manual invoice header/totals were not persisted exactly".to_string());
    }
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .collect();
    if lines.len() != 4 {
        return Err(format!(
            "manual invoice expected 4 lines, got {}",
            lines.len()
        ));
    }
    let debit: f64 = lines.iter().map(|line| line.debit).sum();
    let credit: f64 = lines.iter().map(|line| line.credit).sum();
    if (debit - 207.0).abs() > 0.005 || (credit - 207.0).abs() > 0.005 {
        return Err(format!(
            "manual invoice is not balanced: debit={debit} credit={credit}"
        ));
    }
    let fractional = lines
        .iter()
        .find(|line| line.name == "Fractional consulting hours")
        .ok_or("fractional manual invoice line missing")?;
    if (fractional.quantity - 1.5).abs() > f64::EPSILON
        || (fractional.price_unit - 100.0).abs() > f64::EPSILON
        || (fractional.price_subtotal - 150.0).abs() > 0.005
    {
        return Err("fractional quantity or exact line amounts were lost".to_string());
    }

    let mut conflicting = params.clone();
    conflicting.lines[0].quantity = 2.0;
    let conflict = create_manual_invoice(ctx, fixture.organization_id, conflicting)
        .expect_err("changed payload must not reuse a manual invoice idempotency key");
    if !conflict.contains("different create_manual_invoice input") {
        return Err(format!("unexpected idempotency conflict: {conflict}"));
    }

    let before_moves = ctx.db.account_move().iter().count();
    let before_lines = ctx.db.account_move_line().iter().count();
    let invalid = CreateManualInvoiceParams {
        idempotency_key: format!("manual-invoice-invalid:{}", fixture.company_id),
        lines: vec![ManualInvoiceLineParams {
            account_id: receivable_id,
            name: "Wrong-role line".to_string(),
            quantity: 1.0,
            price_unit: 25.0,
            discount: 0.0,
            tax_ids: vec![],
        }],
        ..params.clone()
    };
    if create_manual_invoice(ctx, fixture.organization_id, invalid).is_ok() {
        return Err("manual invoice accepted a receivable account as an income line".to_string());
    }
    if ctx.db.account_move().iter().count() != before_moves
        || ctx.db.account_move_line().iter().count() != before_lines
    {
        return Err("rejected manual invoice left partial accounting rows".to_string());
    }

    let tax_without_posting_account =
        seed_manual_invoice_tax(ctx, &fixture, "missing-account", false)?;
    let invalid_tax = CreateManualInvoiceParams {
        idempotency_key: format!("manual-invoice-invalid-tax:{}", fixture.company_id),
        lines: vec![ManualInvoiceLineParams {
            account_id: revenue_id,
            name: "Tax without ledger account".to_string(),
            quantity: 1.0,
            price_unit: 25.0,
            discount: 0.0,
            tax_ids: vec![tax_without_posting_account],
        }],
        ..params.clone()
    };
    if create_manual_invoice(ctx, fixture.organization_id, invalid_tax).is_ok() {
        return Err("manual invoice accepted a tax without a posting account".to_string());
    }
    if ctx.db.account_move().iter().count() != before_moves
        || ctx.db.account_move_line().iter().count() != before_lines
    {
        return Err("rejected tax configuration left partial accounting rows".to_string());
    }

    let foreign_currency_id = ctx
        .db
        .currency()
        .iter()
        .find(|currency| {
            currency.organization_id == fixture.organization_id && currency.code == "EUR"
        })
        .map(|currency| currency.id)
        .ok_or("manual invoice test foreign currency missing")?;
    let (foreign_journal_id, _) =
        seed_manual_invoice_sales_journal(ctx, &fixture, foreign_currency_id, "FOREIGN")?;
    let foreign_currency_invoice = CreateManualInvoiceParams {
        idempotency_key: format!("manual-invoice-foreign-currency:{}", fixture.company_id),
        journal_id: foreign_journal_id,
        currency_id: foreign_currency_id,
        lines: vec![ManualInvoiceLineParams {
            account_id: revenue_id,
            name: "Unconverted foreign amount".to_string(),
            quantity: 1.0,
            price_unit: 25.0,
            discount: 0.0,
            tax_ids: vec![],
        }],
        ..params
    };
    let foreign_error =
        create_manual_invoice(ctx, fixture.organization_id, foreign_currency_invoice)
            .expect_err("manual invoice must reject foreign currency without FX conversion");
    if !foreign_error.contains("FX conversion") {
        return Err(format!(
            "manual invoice returned the wrong foreign-currency error: {foreign_error}"
        ));
    }
    if ctx.db.account_move().iter().count() != before_moves
        || ctx.db.account_move_line().iter().count() != before_lines
    {
        return Err("rejected foreign-currency invoice left partial accounting rows".to_string());
    }

    Ok(())
}

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

    if (move_record.amount_untaxed - amount).abs() > 0.01
        || (move_record.amount_total - amount).abs() > 0.01
        || (move_record.amount_residual - amount).abs() > 0.01
        || move_record.payment_state != PaymentState::NotPaid
    {
        return Err(format!(
            "Expected a wholly unpaid {amount} invoice, got untaxed={} total={} residual={} payment={:?}",
            move_record.amount_untaxed,
            move_record.amount_total,
            move_record.amount_residual,
            move_record.payment_state,
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

pub fn test_reset_account_move_to_draft_only_from_cancelled(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    let move_id = create_balanced_customer_invoice(ctx, &fixture, 100.0, false)?;

    if reset_account_move_to_draft(ctx, org_id, move_id).is_ok() {
        return Err("reset of an already-draft move succeeded".to_string());
    }

    cancel_account_move(ctx, org_id, move_id)?;
    reset_account_move_to_draft(ctx, org_id, move_id)?;

    let reset = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("move missing after reset")?;
    if reset.state != AccountMoveState::Draft {
        return Err(format!("Expected Draft after reset, got {:?}", reset.state));
    }
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    if lines.is_empty()
        || lines
            .iter()
            .any(|l| l.parent_state != AccountMoveState::Draft)
    {
        return Err("move lines were not returned to Draft".to_string());
    }

    // `create_balanced_customer_invoice` keys the move by its reference label, so a second call
    // with the default label returns the first move again; a distinct label gives a distinct move.
    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing AR account")?;
    let posted_id = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        50.0,
        ar_id,
        "Harness posted invoice",
        true,
    )?;
    if posted_id == move_id {
        return Err("the posted invoice reused the first move".to_string());
    }
    match reset_account_move_to_draft(ctx, org_id, posted_id) {
        Err(error) if error.contains("Posted") => {}
        Err(error) => return Err(format!("unexpected posted reset error: {error}")),
        Ok(()) => return Err("reset of a posted move succeeded".to_string()),
    }

    match cancel_account_move(ctx, org_id, posted_id) {
        Err(error) if error.contains("credit note or reversal") => {}
        Err(error) => return Err(format!("unexpected posted cancellation error: {error}")),
        Ok(()) => return Err("cancellation of a posted move succeeded".to_string()),
    }
    let posted = ctx
        .db
        .account_move()
        .id()
        .find(&posted_id)
        .ok_or("posted move missing")?;
    if posted.state != AccountMoveState::Posted || !posted.posted_before {
        return Err("rejected cancellation changed the posted move".to_string());
    }
    if ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&posted_id)
        .any(|line| line.parent_state != AccountMoveState::Posted)
    {
        return Err("rejected cancellation changed a posted move line".to_string());
    }

    let other = OrgFixture::seed_minimal(ctx)?;
    cancel_account_move(ctx, org_id, move_id)?;
    match reset_account_move_to_draft(ctx, other.organization_id, move_id) {
        Err(error) if error.contains("organization") => {}
        Err(error) => return Err(format!("unexpected cross-tenant reset error: {error}")),
        Ok(()) => return Err("cross-tenant reset succeeded".to_string()),
    }
    Ok(())
}
