//! Atomic producer for operator-entered customer invoices and vendor bills.
//!
//! The generic `create_account_move` reducer intentionally creates only a move
//! header. This producer owns the stronger manual-invoice invariant: one draft
//! move, its canonical balanced lines, and one exact operation receipt are
//! committed in the same SpacetimeDB transaction.

use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line, AccountMove,
    AddAccountMoveLineParams,
};
use crate::accounting::money::validate_pilot_money_amount;
use crate::accounting::payment_terms::account_payment_term;
use crate::accounting::relations::{
    require_active_account, require_active_currency_id, require_active_journal, require_active_tax,
    require_active_tax_ids, require_contact_in_scope,
};
use crate::accounting::tax_management::account_tax_group;
use crate::core::organization::{company, require_company_in_organization};
use crate::documents::invoice_profile::{
    capture_invoice_document_metadata, without_invoice_document_metadata,
};
use crate::helpers::{calculate_tax, check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::types::{
    AccountInternalGroup, AccountMoveState, AccountTypeInternal, JournalType, MoveType,
    PaymentState, TaxAmountType, TaxTypeUse,
};

const ACTION_KIND: &str = "create_manual_account_invoice";

fn validate_request_token(key: &str) -> Result<(), String> {
    if key.len() != 32
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(
            "manual account invoice idempotency key must be exactly 32 lowercase hex characters"
                .to_string(),
        );
    }
    Ok(())
}

/// One commercial line entered by an operator on a manual invoice or bill.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ManualAccountInvoiceLineInput {
    pub account_id: u64,
    pub name: String,
    pub quantity: f64,
    pub price_unit: f64,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub product_id: Option<u64>,
}

/// Input for one atomic manual customer invoice or vendor bill.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateManualAccountInvoiceParams {
    pub idempotency_key: String,
    pub company_id: u64,
    pub move_type: MoveType,
    pub journal_id: u64,
    pub partner_id: u64,
    pub counterpart_account_id: u64,
    pub currency_id: u64,
    pub date: Timestamp,
    pub invoice_date: Timestamp,
    pub invoice_date_due: Option<Timestamp>,
    pub invoice_payment_term_id: Option<u64>,
    pub ref_: Option<String>,
    pub payment_reference: Option<String>,
    pub metadata: Option<String>,
    pub lines: Vec<ManualAccountInvoiceLineInput>,
}

#[derive(Clone)]
struct PreparedTaxLine {
    account_id: u64,
    tax_id: u64,
    tax_group_id: u64,
    name: String,
    amount: f64,
}

#[derive(Clone)]
struct PreparedCommercialLine {
    input: ManualAccountInvoiceLineInput,
    subtotal: f64,
    taxes: Vec<PreparedTaxLine>,
}

fn expected_journal_type(move_type: &MoveType) -> Result<JournalType, String> {
    match move_type {
        MoveType::OutInvoice => Ok(JournalType::Sale),
        MoveType::InInvoice => Ok(JournalType::Purchase),
        _ => Err(
            "manual account invoice supports only customer invoices and vendor bills".to_string(),
        ),
    }
}

fn expected_counterpart_type(move_type: &MoveType) -> AccountTypeInternal {
    match move_type {
        MoveType::OutInvoice => AccountTypeInternal::Receivable,
        MoveType::InInvoice => AccountTypeInternal::Payable,
        _ => unreachable!("move type is validated before counterpart account"),
    }
}

fn expected_commercial_group(move_type: &MoveType) -> AccountInternalGroup {
    match move_type {
        MoveType::OutInvoice => AccountInternalGroup::Income,
        MoveType::InInvoice => AccountInternalGroup::Expense,
        _ => unreachable!("move type is validated before commercial account"),
    }
}

fn required_tax_use(move_type: &MoveType) -> TaxTypeUse {
    match move_type {
        MoveType::OutInvoice => TaxTypeUse::Sale,
        MoveType::InInvoice => TaxTypeUse::Purchase,
        _ => unreachable!("move type is validated before tax"),
    }
}

fn tax_account_for_move(
    move_type: &MoveType,
    group: &crate::accounting::tax_management::AccountTaxGroup,
) -> Option<u64> {
    match move_type {
        MoveType::OutInvoice => group.tax_payable_account_id,
        MoveType::InInvoice => group.tax_receivable_account_id,
        _ => None,
    }
}

fn validate_product(
    ctx: &ReducerContext,
    organization_id: u64,
    move_type: &MoveType,
    product_id: u64,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or_else(|| format!("invoice product {product_id} not found"))?;
    if product.organization_id != organization_id {
        return Err(format!(
            "invoice product {product_id} does not belong to this organization"
        ));
    }
    if !product.active {
        return Err(format!("invoice product {product_id} is archived"));
    }
    let allowed = match move_type {
        MoveType::OutInvoice => product.sale_ok,
        MoveType::InInvoice => product.purchase_ok,
        _ => false,
    };
    if !allowed {
        return Err(format!(
            "invoice product {product_id} is not enabled for this invoice type"
        ));
    }
    Ok(())
}

fn prepare_lines(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    move_type: &MoveType,
    journal_id: u64,
    lines: &[ManualAccountInvoiceLineInput],
) -> Result<(Vec<PreparedCommercialLine>, f64, f64), String> {
    if lines.is_empty() {
        return Err("manual account invoice requires at least one line".to_string());
    }

    let expected_group = expected_commercial_group(move_type);
    let expected_tax_use = required_tax_use(move_type);
    let mut amount_untaxed = 0.0;
    let mut amount_tax = 0.0;
    let mut prepared = Vec::with_capacity(lines.len());

    for (index, input) in lines.iter().enumerate() {
        let line_number = index + 1;
        if input.name.trim().is_empty() {
            return Err(format!("invoice line {line_number} name is required"));
        }
        if !input.quantity.is_finite() || input.quantity <= 0.0 {
            return Err(format!(
                "invoice line {line_number} quantity must be finite and greater than zero"
            ));
        }
        if !input.price_unit.is_finite() || input.price_unit < 0.0 {
            return Err(format!(
                "invoice line {line_number} price_unit must be finite and non-negative"
            ));
        }
        if !input.discount.is_finite() || !(0.0..=100.0).contains(&input.discount) {
            return Err(format!(
                "invoice line {line_number} discount must be between 0 and 100"
            ));
        }

        let account = require_active_account(
            ctx,
            organization_id,
            company_id,
            input.account_id,
            "invoice line",
        )?;
        if account.internal_group.as_ref() != Some(&expected_group) {
            return Err(format!(
                "invoice line {line_number} account must be {:?}",
                expected_group
            ));
        }
        if account.is_off_balance {
            return Err(format!(
                "invoice line {line_number} cannot use an off-balance account"
            ));
        }
        if !account.allowed_journal_ids.is_empty()
            && !account.allowed_journal_ids.contains(&journal_id)
        {
            return Err(format!(
                "invoice line {line_number} account is not allowed for this journal"
            ));
        }

        if let Some(product_id) = input.product_id {
            validate_product(ctx, organization_id, move_type, product_id)?;
        }
        require_active_tax_ids(ctx, organization_id, company_id, &input.tax_ids)?;

        let subtotal = input.quantity * input.price_unit * (1.0 - input.discount / 100.0);
        validate_pilot_money_amount(&format!("invoice line {line_number} subtotal"), subtotal)?;
        let mut taxes = Vec::with_capacity(input.tax_ids.len());
        for tax_id in &input.tax_ids {
            let tax = require_active_tax(ctx, organization_id, company_id, *tax_id, "invoice")?;
            if tax.type_tax_use != expected_tax_use && tax.type_tax_use != TaxTypeUse::None {
                return Err(format!(
                    "invoice tax {} is not valid for this invoice type",
                    tax.name
                ));
            }
            if tax.price_include {
                return Err(format!(
                    "invoice tax {} is price-included; manual invoice price-included tax is not supported",
                    tax.name
                ));
            }
            if tax.amount_type == TaxAmountType::PythonCode {
                return Err(format!(
                    "invoice tax {} uses PythonCode and cannot be evaluated by this producer",
                    tax.name
                ));
            }
            if tax.has_negative_factor || tax.amount < 0.0 {
                return Err(format!(
                    "invoice tax {} is a withholding/negative tax and is not supported",
                    tax.name
                ));
            }
            let group_id = tax
                .tax_group_id
                .ok_or_else(|| format!("invoice tax {} has no tax group", tax.name))?;
            let group = ctx
                .db
                .account_tax_group()
                .id()
                .find(&group_id)
                .ok_or_else(|| format!("invoice tax {} tax group not found", tax.name))?;
            if group.organization_id != organization_id || group.company_id != company_id {
                return Err(format!(
                    "invoice tax {} group does not belong to this organization and company",
                    tax.name
                ));
            }
            let tax_account_id = tax_account_for_move(move_type, &group).ok_or_else(|| {
                format!(
                    "invoice tax {} group has no configured tax account for this invoice type",
                    tax.name
                )
            })?;
            require_active_account(
                ctx,
                organization_id,
                company_id,
                tax_account_id,
                "invoice tax",
            )?;

            let tax_amount = calculate_tax(ctx, &[*tax_id], subtotal);
            validate_pilot_money_amount(
                &format!("invoice line {line_number} tax amount"),
                tax_amount,
            )?;
            if tax_amount < 0.0 {
                return Err(format!(
                    "invoice tax {} computed a negative amount",
                    tax.name
                ));
            }
            taxes.push(PreparedTaxLine {
                account_id: tax_account_id,
                tax_id: *tax_id,
                tax_group_id: group_id,
                name: tax.name,
                amount: tax_amount,
            });
            amount_tax += tax_amount;
        }

        amount_untaxed += subtotal;
        prepared.push(PreparedCommercialLine {
            input: input.clone(),
            subtotal,
            taxes,
        });
    }

    validate_pilot_money_amount("invoice untaxed total", amount_untaxed)?;
    validate_pilot_money_amount("invoice tax total", amount_tax)?;
    validate_pilot_money_amount("invoice total", amount_untaxed + amount_tax)?;
    if amount_untaxed + amount_tax <= 0.0 {
        return Err("manual account invoice total must be greater than zero".to_string());
    }
    Ok((prepared, amount_untaxed, amount_tax))
}

fn base_line(account_id: u64, name: String, sequence: u32) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name,
        debit: 0.0,
        credit: 0.0,
        sequence,
        quantity: 1.0,
        price_unit: 0.0,
        discount: 0.0,
        tax_ids: vec![],
        partner_id: None,
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

/// Create one canonical draft invoice/bill and all of its balanced lines.
///
/// Replaying the same idempotency key with identical input returns without new
/// writes. Reusing it with different input fails through the shared accounting
/// receipt invariant. The committed receipt points exactly to the move ID.
#[spacetimedb::reducer]
pub fn create_manual_account_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateManualAccountInvoiceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    check_permission(ctx, organization_id, "account_move_line", "create")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    validate_request_token(&params.idempotency_key)?;

    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        params.company_id,
        ACTION_KIND,
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }

    let expected_journal_type = expected_journal_type(&params.move_type)?;
    let journal = require_active_journal(
        ctx,
        organization_id,
        params.company_id,
        params.journal_id,
        "manual invoice",
    )?;
    if journal.type_ != expected_journal_type {
        return Err(format!(
            "manual {:?} requires a {:?} journal",
            params.move_type, expected_journal_type
        ));
    }

    let company = ctx
        .db
        .company()
        .id()
        .find(&params.company_id)
        .ok_or("manual invoice company not found")?;
    require_active_currency_id(ctx, params.currency_id, "manual invoice")?;
    let effective_currency_id = journal.currency_id.unwrap_or(company.currency_id);
    if params.currency_id != effective_currency_id {
        return Err(
            "manual invoice currency must match the selected journal currency (or company currency when the journal has none)"
                .to_string(),
        );
    }

    let partner = require_contact_in_scope(
        ctx,
        organization_id,
        params.company_id,
        params.partner_id,
        "invoice partner",
    )?;
    // The accounting transaction date owns the ledger period. `invoice_date`
    // remains the commercial document date used for due-date validation.
    ensure_accounting_period_open_for_date(ctx, params.company_id, params.date)?;
    if let Some(due) = params.invoice_date_due {
        if due.to_micros_since_unix_epoch() < params.invoice_date.to_micros_since_unix_epoch() {
            return Err("manual invoice due date cannot precede invoice date".to_string());
        }
    }
    if let Some(term_id) = params.invoice_payment_term_id {
        let term = ctx
            .db
            .account_payment_term()
            .id()
            .find(&term_id)
            .ok_or("manual invoice payment term not found")?;
        if term.organization_id != organization_id || !term.is_active {
            return Err(
                "manual invoice payment term is inactive or outside the organization".to_string(),
            );
        }
    }

    let counterpart = require_active_account(
        ctx,
        organization_id,
        params.company_id,
        params.counterpart_account_id,
        "invoice counterpart",
    )?;
    if counterpart.internal_type.as_ref() != Some(&expected_counterpart_type(&params.move_type)) {
        return Err(format!(
            "manual {:?} requires a {:?} counterpart account",
            params.move_type,
            expected_counterpart_type(&params.move_type)
        ));
    }
    if counterpart.is_off_balance || !counterpart.reconcile {
        return Err(
            "manual invoice counterpart must be an on-balance reconciliable account".to_string(),
        );
    }
    if !counterpart.allowed_journal_ids.is_empty()
        && !counterpart.allowed_journal_ids.contains(&params.journal_id)
    {
        return Err("invoice counterpart account is not allowed for this journal".to_string());
    }

    let (prepared_lines, amount_untaxed, amount_tax) = prepare_lines(
        ctx,
        organization_id,
        params.company_id,
        &params.move_type,
        params.journal_id,
        &params.lines,
    )?;
    let amount_total = amount_untaxed + amount_tax;
    let metadata = if params.move_type == MoveType::OutInvoice {
        Some(capture_invoice_document_metadata(
            ctx,
            organization_id,
            params.company_id,
            Some(params.partner_id),
            params.metadata.as_deref(),
        )?)
    } else {
        without_invoice_document_metadata(params.metadata.as_deref())
    };

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: params.ref_.clone(),
        move_type: params.move_type.clone(),
        auto_post: false,
        state: AccountMoveState::Draft,
        date: params.date,
        invoice_date: Some(params.invoice_date),
        invoice_date_due: params.invoice_date_due,
        invoice_payment_term_id: params.invoice_payment_term_id,
        invoice_origin: None,
        invoice_partner_display_name: Some(partner.display_name.clone()),
        invoice_cash_rounding_id: None,
        payment_reference: params.payment_reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(params.partner_id),
        commercial_partner_id: Some(params.partner_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id: params.company_id,
        journal_id: params.journal_id,
        currency_id: params.currency_id,
        company_currency_id: company.currency_id,
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: journal.restrict_mode_hash_table,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    let is_customer_invoice = params.move_type == MoveType::OutInvoice;
    let mut sequence = 0_u32;
    for prepared in prepared_lines {
        let mut commercial = base_line(prepared.input.account_id, prepared.input.name, sequence);
        if is_customer_invoice {
            commercial.credit = prepared.subtotal;
        } else {
            commercial.debit = prepared.subtotal;
        }
        commercial.quantity = prepared.input.quantity;
        commercial.price_unit = prepared.input.price_unit;
        commercial.discount = prepared.input.discount;
        commercial.tax_ids = prepared.input.tax_ids;
        commercial.partner_id = Some(params.partner_id);
        commercial.product_id = prepared.input.product_id;
        insert_draft_account_move_line(ctx, &move_record, commercial)?;
        sequence += 1;

        for tax in prepared.taxes {
            let mut tax_line = base_line(tax.account_id, tax.name, sequence);
            if is_customer_invoice {
                tax_line.credit = tax.amount;
            } else {
                tax_line.debit = tax.amount;
            }
            tax_line.price_unit = tax.amount;
            tax_line.tax_ids = vec![tax.tax_id];
            tax_line.tax_line_id = Some(tax.tax_id);
            tax_line.tax_group_id = Some(tax.tax_group_id);
            tax_line.partner_id = Some(params.partner_id);
            tax_line.exclude_from_invoice_tab = true;
            insert_draft_account_move_line(ctx, &move_record, tax_line)?;
            sequence += 1;
        }
    }

    let mut counterpart_line = base_line(
        params.counterpart_account_id,
        partner.display_name,
        sequence,
    );
    if is_customer_invoice {
        counterpart_line.debit = amount_total;
    } else {
        counterpart_line.credit = amount_total;
    }
    counterpart_line.price_unit = amount_total;
    counterpart_line.partner_id = Some(params.partner_id);
    counterpart_line.exclude_from_invoice_tab = true;
    counterpart_line.expected_pay_date = params.invoice_date_due;
    counterpart_line.expected_pay_date_currency_id = Some(params.currency_id);
    counterpart_line.expected_pay_date_amount = amount_total;
    counterpart_line.expected_pay_date_residual = amount_total;
    insert_draft_account_move_line(ctx, &move_record, counterpart_line)?;

    let (total_debit, total_credit) = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .fold((0.0, 0.0), |(debit, credit), line| {
            (debit + line.debit, credit + line.credit)
        });
    if (total_debit - total_credit).abs() > 0.000_001 {
        return Err("manual account invoice did not produce balanced move lines".to_string());
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "account_move",
            record_id: move_record.id,
            action: "CREATE_MANUAL_INVOICE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "move_type": format!("{:?}", params.move_type),
                    "partner_id": params.partner_id,
                    "amount_untaxed": amount_untaxed,
                    "amount_tax": amount_tax,
                    "amount_total": amount_total,
                    "commercial_line_count": params.lines.len(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "move_type".to_string(),
                "partner_id".to_string(),
                "amount_untaxed".to_string(),
                "amount_tax".to_string(),
                "amount_total".to_string(),
                "line_ids".to_string(),
            ],
            metadata: None,
        },
    );

    record_result(
        ctx,
        organization_id,
        params.company_id,
        ACTION_KIND,
        params.idempotency_key,
        payload_fingerprint,
        "account_move",
        move_record.id,
    );
    Ok(())
}
