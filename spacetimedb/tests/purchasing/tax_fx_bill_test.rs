//! Tax/FX producer regressions invoked by the existing Purchasing wave reducer.
use super::gap_fixes_test::seed_vendor_po;
use super::wave_e_test::{empty_move_line, expense_and_ap};
use crate::accounting::chart_of_accounts::{
    account_account, account_journal, create_account_journal, AccountAccount,
    CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, create_bill_from_purchase_order, post_invoice,
    update_account_move_line, CreateBillFromPurchaseOrderParams, UpdateAccountMoveLineParams,
};
use crate::accounting::tax_management::{
    account_tax, account_tax_group, AccountTax, AccountTaxGroup,
};
use crate::core::reference::{currency, currency_rate, CurrencyRate};
use crate::purchasing::purchase_orders::{
    confirm_purchase_order, purchase_order, purchase_order_line, receive_po_line, PurchaseOrder,
    PurchaseOrderLine,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{AccountInternalGroup, JournalType, TaxAmountType, TaxTypeUse};
use spacetimedb::{ReducerContext, Table, Timestamp};

pub fn test_tax_fx_bill_creation(ctx: &ReducerContext) -> Result<(), String> {
    for (taxed, foreign, included) in [
        (false, true, false),
        (true, false, false),
        (true, true, false),
        (true, true, true),
    ] {
        cycle(ctx, taxed, foreign, included)?;
    }
    Ok(())
}

fn cycle(ctx: &ReducerContext, taxed: bool, foreign: bool, included: bool) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let (expense, ap) = expense_and_ap(&fixture)?;
    let (_, po_id) = seed_vendor_po(ctx, &fixture, "COV05J")?;
    let po = ctx.db.purchase_order().id().find(&po_id).ok_or("PO")?;
    let source = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .next()
        .ok_or("source")?;
    let doc_currency = if foreign {
        ctx.db
            .currency()
            .currency_by_organization()
            .filter(&org)
            .find(|c| c.active && c.id != fixture.currency_id)
            .ok_or("foreign currency")?
            .id
    } else {
        fixture.currency_id
    };
    ctx.db.purchase_order().id().update(PurchaseOrder {
        currency_id: doc_currency,
        ..po
    });
    let tax_on_order = if !taxed {
        0.0
    } else if included {
        5.0
    } else {
        6.0
    };
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        currency_id: doc_currency,
        price_subtotal: if included { 25.0 } else { 30.0 },
        price_tax: tax_on_order,
        price_total: if included { 30.0 } else { 30.0 + tax_on_order },
        ..source
    });
    // A functional-currency journal must not replace the PO document currency.
    let code = format!("TJ{org}");
    create_account_journal(
        ctx,
        org,
        CreateAccountJournalParams {
            company_id: Some(fixture.company_id),
            name: code.clone(),
            code: code.clone(),
            type_: JournalType::Purchase,
            currency_id: Some(fixture.currency_id),
            default_account_id: Some(expense),
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
    let journal = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org && j.code == code)
        .ok_or("journal")?;
    let input_account = ctx.db.account_account().insert(AccountAccount {
        id: 0,
        code: format!("IT{org}"),
        name: "Input tax".into(),
        internal_type: None,
        internal_group: Some(AccountInternalGroup::Asset),
        ..ctx
            .db
            .account_account()
            .id()
            .find(&expense)
            .ok_or("expense account")?
    });
    let group = ctx.db.account_tax_group().insert(AccountTaxGroup {
        id: 0,
        organization_id: org,
        company_id: fixture.company_id,
        name: "Input VAT".into(),
        sequence: 1,
        preceding_subtotal: None,
        tax_payable_account_id: None,
        tax_receivable_account_id: Some(input_account.id),
        advance_tax_payment_account_id: None,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: None,
        write_date: None,
        metadata: None,
    });
    let tax = ctx.db.account_tax().insert(AccountTax {
        id: 0,
        organization_id: org,
        company_id: fixture.company_id,
        name: "Purchase VAT".into(),
        description: None,
        type_tax_use: TaxTypeUse::Purchase,
        amount_type: TaxAmountType::Percent,
        amount: 20.0,
        active: true,
        price_include: included,
        include_base_amount: false,
        is_base_affected: false,
        sequence: 1,
        tax_group_id: Some(group.id),
        country_id: None,
        country_code: None,
        tags: vec![],
        has_negative_factor: false,
        invoice_repartition_line_ids: vec![],
        refund_repartition_line_ids: vec![],
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: None,
        write_date: None,
        metadata: None,
    });
    let source_id = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .next()
        .ok_or("source")?
        .id;
    confirm_purchase_order(ctx, org, po_id)?;
    receive_po_line(ctx, org, source_id, 1.0, None)?;
    let mut expense_line = empty_move_line(expense);
    expense_line.discount = 10.0;
    if taxed {
        expense_line.tax_ids = vec![tax.id];
    }
    let mut params = CreateBillFromPurchaseOrderParams {
        journal_id: journal.id,
        default_expense_account_id: expense,
        invoice_date: ctx.timestamp,
        expense_line,
        payable_line: empty_move_line(ap),
        metadata: None,
    };
    let discount_error = create_bill_from_purchase_order(ctx, org, po_id, params.clone())
        .expect_err("PO bill discount without PO evidence must fail");
    if !discount_error.contains("zero discount") {
        return Err("PO bill discount rejection was not explicit".into());
    }
    params.expense_line.discount = 0.0;
    // Missing rates and mappings fail before canonical bills, rows or quantities change.
    if foreign {
        rejected(ctx, org, po_id, params.clone())?;
    }
    if taxed {
        ctx.db.account_tax_group().id().update(AccountTaxGroup {
            tax_receivable_account_id: None,
            ..group.clone()
        });
        rejected(ctx, org, po_id, params.clone())?;
        ctx.db.account_tax_group().id().update(group.clone());
        let mut wrong = params.clone();
        wrong.expense_line.tax_ids.clear();
        rejected(ctx, org, po_id, wrong)?;
        let mut duplicate = params.clone();
        duplicate.expense_line.tax_ids.push(tax.id);
        rejected(ctx, org, po_id, duplicate)?;
    }
    if foreign {
        ctx.db.currency_rate().insert(CurrencyRate {
            id: 0,
            organization_id: org,
            company_id: Some(fixture.company_id),
            from_currency_id: doc_currency,
            to_currency_id: fixture.currency_id,
            rate: 1.25,
            inverse_rate: 0.8,
            date: Timestamp::from_micros_since_unix_epoch(
                ctx.timestamp.to_micros_since_unix_epoch() - 2,
            ),
            created_at: ctx.timestamp,
            metadata: None,
        });
    }
    let first = create_and_verify(
        ctx,
        &fixture,
        po_id,
        params.clone(),
        1.0,
        taxed,
        foreign,
        included,
    )?;
    post_invoice(ctx, org, first, expense, expense)?;
    let first_after = ctx
        .db
        .account_move()
        .id()
        .find(&first)
        .ok_or("first bill")?;
    receive_po_line(ctx, org, source_id, 2.0, None)?;
    let second = create_and_verify(ctx, &fixture, po_id, params, 2.0, taxed, foreign, included)?;
    if first == second {
        return Err("later receipt reused the earlier bill".into());
    }
    correct_and_verify(ctx, &fixture, po_id, second, taxed, foreign, included)?;
    let unchanged = ctx
        .db
        .account_move()
        .id()
        .find(&first)
        .ok_or("first bill")?;
    let source = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&source_id)
        .ok_or("source")?;
    if source.qty_invoiced != 3.0
        || source.invoice_lines.len() != 2
        || unchanged.state != first_after.state
        || unchanged.amount_total != first_after.amount_total
        || unchanged.amount_total_signed != first_after.amount_total_signed
    {
        return Err("partial tax/FX billing altered the prior bill or source conservation".into());
    }
    Ok(())
}

fn correct_and_verify(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    po_id: u64,
    bill_id: u64,
    taxed: bool,
    foreign: bool,
    included: bool,
) -> Result<(), String> {
    let org = fixture.organization_id;
    let bill = ctx.db.account_move().id().find(&bill_id).ok_or("bill")?;
    if foreign {
        let invoice_date = bill.invoice_date.ok_or("bill date")?;
        ctx.db.currency_rate().insert(CurrencyRate {
            id: 0,
            organization_id: org,
            company_id: Some(fixture.company_id),
            from_currency_id: bill.currency_id,
            to_currency_id: bill.company_currency_id,
            rate: 2.0,
            inverse_rate: 0.5,
            date: Timestamp::from_micros_since_unix_epoch(
                invoice_date.to_micros_since_unix_epoch() - 1,
            ),
            created_at: ctx.timestamp,
            metadata: Some("backdated after bill creation".into()),
        });
    }
    let product = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&bill_id)
        .find(|line| line.product_id.is_some())
        .ok_or("product")?;
    let correction = |quantity, expected_quantity| UpdateAccountMoveLineParams {
        company_id: Some(fixture.company_id),
        name: None,
        debit: None,
        credit: None,
        partner_id: None,
        analytic_account_id: None,
        metadata: None,
        quantity: Some(quantity),
        price_unit: Some(product.price_unit),
        expected_quantity: Some(expected_quantity),
        expected_price_unit: Some(product.price_unit),
    };

    let direct_amount_error = update_account_move_line(
        ctx,
        org,
        product.id,
        UpdateAccountMoveLineParams {
            company_id: Some(fixture.company_id),
            name: None,
            debit: Some(product.debit / 2.0),
            credit: None,
            partner_id: None,
            analytic_account_id: None,
            metadata: None,
            quantity: None,
            price_unit: None,
            expected_quantity: None,
            expected_price_unit: None,
        },
    )
    .expect_err("direct PO bill amount edits must fail");
    if !direct_amount_error.contains("amounts are derived")
        || ctx
            .db
            .account_move_line()
            .id()
            .find(&product.id)
            .ok_or("product after rejected edit")?
            .debit
            != product.debit
    {
        return Err("rejected direct PO bill amount edit changed accounting evidence".into());
    }

    update_account_move_line(ctx, org, product.id, correction(1.0, 2.0))?;
    verify_corrected_bill(
        ctx, po_id, bill_id, product.id, taxed, foreign, included, 1.0,
    )?;

    update_account_move_line(ctx, org, product.id, correction(2.0, 1.0))?;
    verify_corrected_bill(
        ctx, po_id, bill_id, product.id, taxed, foreign, included, 2.0,
    )
}

#[allow(clippy::too_many_arguments)]
fn verify_corrected_bill(
    ctx: &ReducerContext,
    po_id: u64,
    bill_id: u64,
    product_id: u64,
    taxed: bool,
    foreign: bool,
    included: bool,
    quantity: f64,
) -> Result<(), String> {
    let bill = ctx.db.account_move().id().find(&bill_id).ok_or("bill")?;
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&bill_id)
        .collect();
    let product = lines
        .iter()
        .find(|line| line.id == product_id)
        .ok_or("corrected product")?;
    let source = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .find(|line| line.invoice_lines.contains(&product_id))
        .ok_or("exact source")?;
    let net = quantity * 10.0 / if included { 1.2 } else { 1.0 };
    let tax = if taxed { net * 0.2 } else { 0.0 };
    let rate = if foreign { 1.25 } else { 1.0 };
    let ledger = |amount: f64| {
        if foreign {
            (amount * rate * 100.0).round() / 100.0
        } else {
            amount
        }
    };
    let debit: f64 = lines.iter().map(|line| line.debit).sum();
    let credit: f64 = lines.iter().map(|line| line.credit).sum();
    let tax_lines: Vec<_> = lines
        .iter()
        .filter(|line| line.tax_line_id.is_some())
        .collect();
    if product.quantity != quantity
        || product.discount != 0.0
        || (product.price_subtotal - net).abs() > 1e-8
        || (product.price_total - net - tax).abs() > 1e-8
        || (bill.amount_untaxed - net).abs() > 1e-8
        || (bill.amount_tax - tax).abs() > 1e-8
        || (bill.amount_total - net - tax).abs() > 1e-8
        || (bill.amount_total_signed - ledger(net) - ledger(tax)).abs() > 1e-8
        || (debit - credit).abs() > 1e-8
        || tax_lines.len() != usize::from(taxed)
        // The first posted bill retained one unit; this draft owns the corrected remainder.
        || (source.qty_invoiced - (1.0 + quantity)).abs() > 1e-8
    {
        return Err(
            "corrected tax/FX bill did not conserve document, ledger, or source amounts".into(),
        );
    }
    if taxed
        && ((tax_lines[0].price_total - tax).abs() > 1e-8
            || (tax_lines[0].tax_base_amount - net).abs() > 1e-8)
    {
        return Err("corrected tax row amount or base is inconsistent".into());
    }
    Ok(())
}

fn rejected(
    ctx: &ReducerContext,
    org: u64,
    po_id: u64,
    params: CreateBillFromPurchaseOrderParams,
) -> Result<(), String> {
    let before = ctx
        .db
        .purchase_order()
        .id()
        .find(&po_id)
        .ok_or("PO")?
        .invoice_ids;
    let lines_before = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.organization_id == org)
        .count();
    let moves_before = ctx
        .db
        .account_move()
        .iter()
        .filter(|m| m.organization_id == org)
        .count();
    let sources_before: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .map(|p| (p.id, p.qty_invoiced.to_bits(), p.invoice_lines))
        .collect();
    if create_bill_from_purchase_order(ctx, org, po_id, params).is_ok() {
        return Err("invalid tax/FX producer evidence accepted".into());
    }
    let sources_after: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .map(|p| (p.id, p.qty_invoiced.to_bits(), p.invoice_lines))
        .collect();
    if before
        != ctx
            .db
            .purchase_order()
            .id()
            .find(&po_id)
            .ok_or("PO")?
            .invoice_ids
        || sources_before != sources_after
        || lines_before
            != ctx
                .db
                .account_move_line()
                .iter()
                .filter(|l| l.organization_id == org)
                .count()
        || moves_before
            != ctx
                .db
                .account_move()
                .iter()
                .filter(|m| m.organization_id == org)
                .count()
    {
        return Err("rejected producer call left accounting or quantity effects".into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn create_and_verify(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    po_id: u64,
    params: CreateBillFromPurchaseOrderParams,
    quantity: f64,
    taxed: bool,
    foreign: bool,
    included: bool,
) -> Result<u64, String> {
    let org = fixture.organization_id;
    let before = ctx
        .db
        .purchase_order()
        .id()
        .find(&po_id)
        .ok_or("PO")?
        .invoice_ids;
    create_bill_from_purchase_order(ctx, org, po_id, params)?;
    let po = ctx.db.purchase_order().id().find(&po_id).ok_or("PO")?;
    let added: Vec<_> = po
        .invoice_ids
        .iter()
        .filter(|id| !before.contains(id))
        .copied()
        .collect();
    if added.len() != 1 {
        return Err("bill identity not exact".into());
    }
    let bill = ctx.db.account_move().id().find(&added[0]).ok_or("bill")?;
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&bill.id)
        .collect();
    let net = quantity * 10.0 / if included { 1.2 } else { 1.0 };
    let tax_amount = if taxed { net * 0.2 } else { 0.0 };
    let rate = if foreign { 1.25 } else { 1.0 };
    let ledger = |a: f64| {
        if foreign {
            (a * rate * 100.0).round() / 100.0
        } else {
            a
        }
    };
    let debit: f64 = lines.iter().map(|l| l.debit).sum();
    let credit: f64 = lines.iter().map(|l| l.credit).sum();
    let taxes: Vec<_> = lines.iter().filter(|l| l.tax_line_id.is_some()).collect();
    let product = lines
        .iter()
        .find(|l| l.product_id.is_some())
        .ok_or("product")?;
    let source = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .find(|p| p.invoice_lines.contains(&product.id))
        .ok_or("exact source")?;
    if bill.currency_id != po.currency_id
        || (bill.amount_total - net - tax_amount).abs() > 1e-8
        || (bill.amount_tax - tax_amount).abs() > 1e-8
        || (bill.amount_untaxed - net).abs() > 1e-8
        || (debit - credit).abs() > 1e-8
        || (bill.amount_total_signed - ledger(net) - ledger(tax_amount)).abs() > 1e-8
        || product.quantity != quantity
        || product.discount != 0.0
        || taxes.len() != if taxed { 1 } else { 0 }
        || source
            .invoice_lines
            .iter()
            .filter(|id| **id == product.id)
            .count()
            != 1
    {
        return Err(
            "created tax/FX bill does not conserve exact quantities or currency amounts".into(),
        );
    }
    if taxed && (taxes[0].tax_base_amount - net).abs() > 1e-8 {
        return Err("tax base not exact".into());
    }
    Ok(bill.id)
}
