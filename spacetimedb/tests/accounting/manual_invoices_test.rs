//! Domain proof for the atomic manual invoice producer.

use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::idempotency::accounting_operation_receipt;
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::manual_invoices::{
    create_manual_account_invoice, CreateManualAccountInvoiceParams, ManualAccountInvoiceLineInput,
};
use crate::accounting::tax_management::{
    account_tax, account_tax_group, create_account_tax, create_account_tax_group,
    CreateAccountTaxGroupParams, CreateAccountTaxParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountMoveState, JournalType, MoveType, TaxAmountType, TaxTypeUse};

fn seed_sales_journal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let code = format!("MI{}", fixture.company_id);
    create_account_journal(
        ctx,
        fixture.organization_id,
        CreateAccountJournalParams {
            company_id: Some(fixture.company_id),
            name: "Manual Invoice Sales".to_string(),
            code: code.clone(),
            type_: JournalType::Sale,
            currency_id: Some(fixture.currency_id),
            default_account_id: fixture.chart_account_ids.get(chart_keys::REVENUE).copied(),
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
            metadata: Some(r#"{"test":"manual_invoice"}"#.to_string()),
        },
    )?;
    ctx.db
        .account_journal()
        .iter()
        .find(|journal| {
            journal.organization_id == fixture.organization_id
                && journal.company_id == fixture.company_id
                && journal.code == code
        })
        .map(|journal| journal.id)
        .ok_or_else(|| "manual invoice sales journal missing after create".to_string())
}

fn seed_sales_tax(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let group_name = format!("Manual Invoice Tax Group {}", fixture.company_id);
    let payable_account_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("harness missing AP account")?;
    let receivable_account_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing AR account")?;
    create_account_tax_group(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxGroupParams {
            name: group_name.clone(),
            sequence: 10,
            preceding_subtotal: None,
            tax_payable_account_id: Some(payable_account_id),
            tax_receivable_account_id: Some(receivable_account_id),
            advance_tax_payment_account_id: None,
            metadata: Some(r#"{"test":"manual_invoice"}"#.to_string()),
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
        .ok_or("manual invoice tax group missing after create")?;

    let tax_name = format!("Manual Invoice Sales Tax {}", fixture.company_id);
    create_account_tax(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxParams {
            name: tax_name.clone(),
            description: None,
            type_tax_use: TaxTypeUse::Sale,
            amount_type: TaxAmountType::Percent,
            amount: 10.0,
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
            metadata: Some(r#"{"test":"manual_invoice"}"#.to_string()),
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
        .ok_or_else(|| "manual invoice tax missing after create".to_string())
}

pub fn test_manual_invoice_is_atomic_balanced_and_idempotent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let journal_id = seed_sales_journal(ctx, &fixture)?;
    let tax_id = seed_sales_tax(ctx, &fixture)?;
    let revenue_account_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("harness missing revenue account")?;
    let receivable_account_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing AR account")?;
    let request_token = format!("{:032x}", fixture.company_id);
    let params = CreateManualAccountInvoiceParams {
        idempotency_key: request_token.clone(),
        company_id: fixture.company_id,
        move_type: MoveType::OutInvoice,
        journal_id,
        partner_id: fixture.partner_id,
        counterpart_account_id: receivable_account_id,
        currency_id: fixture.currency_id,
        date: ctx.timestamp,
        invoice_date: ctx.timestamp,
        invoice_date_due: Some(ctx.timestamp),
        invoice_payment_term_id: None,
        ref_: Some(format!("manual-invoice-{}", fixture.company_id)),
        payment_reference: Some(format!("manual-payment-{}", fixture.company_id)),
        metadata: Some(r#"{"test":"manual_invoice","notes":"Operator notes","invoiceContent":{"schemaVersion":1,"notice":"Customer notice"},"invoiceDocument":{"seller":{"name":"Forged client seller"}}}"#.to_string()),
        lines: vec![ManualAccountInvoiceLineInput {
            account_id: revenue_account_id,
            name: "Consulting services".to_string(),
            quantity: 2.0,
            price_unit: 50.0,
            discount: 10.0,
            tax_ids: vec![tax_id],
            product_id: None,
        }],
    };

    create_manual_account_invoice(ctx, fixture.organization_id, params.clone())?;

    let receipts: Vec<_> = ctx
        .db
        .accounting_operation_receipt()
        .accounting_operation_receipt_by_scope()
        .filter((
            &fixture.organization_id,
            &fixture.company_id,
            &"create_manual_account_invoice".to_string(),
        ))
        .filter(|receipt| receipt.idempotency_key == request_token)
        .collect();
    if receipts.len() != 1 {
        return Err(format!(
            "expected one exact manual invoice receipt, got {}",
            receipts.len()
        ));
    }
    let receipt = &receipts[0];
    if receipt.result_table != "account_move" {
        return Err(format!(
            "manual invoice receipt points to {}, expected account_move",
            receipt.result_table
        ));
    }

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&receipt.result_id)
        .ok_or("manual invoice receipt result move missing")?;
    let initial_metadata = move_record.metadata.clone();
    let metadata: serde_json::Value = serde_json::from_str(
        initial_metadata
            .as_deref()
            .ok_or("manual invoice snapshot missing")?,
    )
    .map_err(|error| format!("manual invoice metadata invalid: {error}"))?;
    if metadata["invoiceDocument"]["seller"]["name"] == "Forged client seller"
        || metadata["invoiceDocument"]["schemaVersion"] != 2
        || metadata["invoiceDocument"]["buyer"]["partnerId"]
            != move_record
                .partner_id
                .map(|id| id.to_string())
                .unwrap_or_default()
        || metadata["invoiceDocument"]["profile"]["notice"] != "Customer notice"
        || metadata["invoiceDocument"]["notes"] != "Operator notes"
        || metadata["test"] != "manual_invoice"
    {
        return Err(
            "manual invoice snapshot did not preserve content or replace client forgery"
                .to_string(),
        );
    }
    if move_record.organization_id != fixture.organization_id
        || move_record.company_id != fixture.company_id
        || move_record.move_type != MoveType::OutInvoice
        || move_record.state != AccountMoveState::Draft
    {
        return Err("manual invoice receipt resolved the wrong canonical move".to_string());
    }
    if (move_record.amount_untaxed - 90.0).abs() > 0.000_001
        || (move_record.amount_tax - 9.0).abs() > 0.000_001
        || (move_record.amount_total - 99.0).abs() > 0.000_001
        || (move_record.amount_residual - 99.0).abs() > 0.000_001
    {
        return Err(format!(
            "manual invoice totals mismatch: untaxed={} tax={} total={} residual={}",
            move_record.amount_untaxed,
            move_record.amount_tax,
            move_record.amount_total,
            move_record.amount_residual
        ));
    }

    let move_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .collect();
    if move_lines.len() != 3 {
        return Err(format!(
            "expected commercial, tax, and counterpart lines; got {}",
            move_lines.len()
        ));
    }
    let total_debit: f64 = move_lines.iter().map(|line| line.debit).sum();
    let total_credit: f64 = move_lines.iter().map(|line| line.credit).sum();
    if (total_debit - 99.0).abs() > 0.000_001 || (total_credit - 99.0).abs() > 0.000_001 {
        return Err(format!(
            "manual invoice is not balanced at 99: debit={total_debit} credit={total_credit}"
        ));
    }
    if !move_lines.iter().any(|line| {
        line.tax_line_id == Some(tax_id)
            && line.tax_group_id.is_some()
            && (line.credit - 9.0).abs() <= 0.000_001
    }) {
        return Err("manual invoice canonical tax line is missing".to_string());
    }

    create_manual_account_invoice(ctx, fixture.organization_id, params.clone())?;
    if ctx
        .db
        .account_move()
        .id()
        .find(&move_record.id)
        .and_then(|row| row.metadata)
        != initial_metadata
    {
        return Err("manual invoice receipt replay rewrote its document snapshot".to_string());
    }
    let replay_move_count = ctx
        .db
        .account_move()
        .iter()
        .filter(|candidate| {
            candidate.organization_id == fixture.organization_id
                && candidate.company_id == fixture.company_id
                && candidate.ref_.as_deref() == params.ref_.as_deref()
        })
        .count();
    if replay_move_count != 1 {
        return Err(format!(
            "same-key manual invoice replay created {replay_move_count} moves"
        ));
    }

    let mut conflicting = params;
    conflicting.lines[0].price_unit = 51.0;
    match create_manual_account_invoice(ctx, fixture.organization_id, conflicting) {
        Err(error) if error.contains("idempotency key") => {}
        Err(error) => return Err(format!("unexpected conflicting replay error: {error}")),
        Ok(()) => return Err("changed input reused the manual invoice key".to_string()),
    }
    if ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .count()
        != 3
    {
        return Err("conflicting replay changed canonical invoice lines".to_string());
    }

    Ok(())
}
