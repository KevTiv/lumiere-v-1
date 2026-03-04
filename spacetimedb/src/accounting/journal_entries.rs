/// Journal Entries — AccountMove, AccountMoveLine
///
/// # 7.2 Journal Entries
///
/// Tables for accounting journal entries and move lines.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::accounting::chart_of_accounts::{account_account, account_journal};
use crate::core::organization::company;
use crate::helpers::{check_permission, write_audit_log};
use crate::inventory::product::product;
use crate::inventory::stock::stock_quant;
use crate::types::{AccountMoveState, MoveType, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_move,
    public,
    index(accessor = move_by_company, btree(columns = [company_id])),
    index(accessor = move_by_journal, btree(columns = [journal_id])),
    index(accessor = move_by_partner, btree(columns = [partner_id])),
    index(accessor = move_by_state, btree(columns = [state])),
    index(accessor = move_by_date, btree(columns = [date])),
    index(accessor = move_by_name, btree(columns = [name]))
)]
pub struct AccountMove {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub ref_: Option<String>,
    pub move_type: MoveType,
    pub auto_post: bool,
    pub state: AccountMoveState,
    pub date: Timestamp,
    pub invoice_date: Option<Timestamp>,
    pub invoice_date_due: Option<Timestamp>,
    pub invoice_payment_term_id: Option<u64>,
    pub invoice_origin: Option<String>,
    pub invoice_partner_display_name: Option<String>,
    pub invoice_cash_rounding_id: Option<u64>,
    pub payment_reference: Option<String>,
    pub partner_shipping_id: Option<u64>,
    pub sale_order_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub commercial_partner_id: Option<u64>,
    pub partner_bank_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub invoice_user_id: Option<Identity>,
    pub invoice_incoterm_id: Option<u64>,
    pub incoterm_location: Option<String>,
    pub campaign_id: Option<u64>,
    pub source_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub company_id: u64,
    pub journal_id: u64,
    pub currency_id: u64,
    pub company_currency_id: u64,
    pub amount_untaxed: f64,
    pub amount_tax: f64,
    pub amount_total: f64,
    pub amount_residual: f64,
    pub amount_untaxed_signed: f64,
    pub amount_tax_signed: f64,
    pub amount_total_signed: f64,
    pub amount_total_in_currency_signed: f64,
    pub amount_residual_signed: f64,
    pub to_check: bool,
    pub posted_before: bool,
    pub is_storno: bool,
    pub is_move_sent: bool,
    pub secure_sequence_number: Option<u64>,
    pub invoice_has_outstanding: bool,
    pub payment_state: PaymentState,
    pub restrict_mode_hash_table: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_move_line,
    public,
    index(accessor = move_line_by_move, btree(columns = [move_id])),
    index(accessor = move_line_by_account, btree(columns = [account_id])),
    index(accessor = move_line_by_partner, btree(columns = [partner_id])),
    index(accessor = move_line_by_date, btree(columns = [date]))
)]
pub struct AccountMoveLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub move_id: u64,
    pub move_name: Option<String>,
    pub date: Timestamp,
    pub ref_: Option<String>,
    pub parent_state: AccountMoveState,
    pub journal_id: u64,
    pub company_id: u64,
    pub company_currency_id: u64,
    pub sequence: u32,
    pub name: String,
    pub quantity: f64,
    pub price_unit: f64,
    pub price: f64,
    pub price_subtotal: f64,
    pub price_total: f64,
    pub discount: f64,
    pub balance: f64,
    pub currency_id: u64,
    pub amount_currency: f64,
    pub amount_residual: f64,
    pub amount_residual_currency: f64,
    pub debit: f64,
    pub credit: f64,
    pub debit_currency: f64,
    pub credit_currency: f64,
    pub tax_base_amount: f64,
    pub account_id: u64,
    pub account_internal_type: Option<String>,
    pub account_internal_group: Option<String>,
    pub account_root_id: Option<u64>,
    pub group_tax_id: Option<u64>,
    pub tax_line_id: Option<u64>,
    pub tax_group_id: Option<u64>,
    pub tax_ids: Vec<u64>,
    pub tax_repartition_line_id: Option<u64>,
    pub tax_audit: Option<String>,
    pub partner_id: Option<u64>,
    pub commercial_partner_id: Option<u64>,
    pub reconcile_model_id: Option<u64>,
    pub payment_id: Option<u64>,
    pub statement_line_id: Option<u64>,
    pub currency_id_field: Option<u64>,
    pub blocked: bool,
    pub matching_number: Option<String>,
    pub matching_label: Option<String>,
    pub is_matching: bool,
    pub expected_pay_date: Option<Timestamp>,
    pub expected_pay_date_currency_id: Option<u64>,
    pub expected_pay_date_amount: f64,
    pub expected_pay_date_residual: f64,
    pub display_type: Option<String>,
    pub is_downpayment: bool,
    pub exclude_from_invoice_tab: bool,
    pub analytic_account_id: Option<u64>,
    pub analytic_tag_ids: Vec<u64>,
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub product_category_id: Option<u64>,
    pub cogs_amount: f64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Accounting helpers and invoice posting ───────────────────────────────────

fn compute_invoice_totals_internal(ctx: &ReducerContext, move_id: u64) -> Result<(), String> {
    let mut move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    if lines.is_empty() {
        return Err("Cannot compute totals for a move without lines".to_string());
    }

    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;
    let mut amount_total = 0.0f64;
    let mut amount_residual = 0.0f64;

    for line in lines {
        if line.tax_line_id.is_some() || line.tax_group_id.is_some() {
            amount_tax += line.price_total.abs();
        } else {
            amount_untaxed += line.price_subtotal.abs();
        }

        amount_total += line.balance.abs();
        amount_residual += line.amount_residual.abs();
    }

    move_record.amount_untaxed = amount_untaxed;
    move_record.amount_tax = amount_tax;
    move_record.amount_total = if amount_total > 0.0 {
        amount_total
    } else {
        amount_untaxed + amount_tax
    };
    move_record.amount_residual = amount_residual;
    move_record.amount_untaxed_signed = amount_untaxed;
    move_record.amount_tax_signed = amount_tax;
    move_record.amount_total_signed = move_record.amount_total;
    move_record.amount_total_in_currency_signed = move_record.amount_total;
    move_record.amount_residual_signed = amount_residual;
    move_record.write_uid = Some(ctx.sender());
    move_record.write_date = Some(ctx.timestamp);

    ctx.db.account_move().id().update(move_record);
    Ok(())
}

fn compute_weighted_average_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    required_qty: f64,
) -> f64 {
    if required_qty <= 0.0 {
        return 0.0;
    }

    let mut total_qty = 0.0f64;
    let mut total_value = 0.0f64;

    for quant in ctx.db.stock_quant().quant_by_product().filter(&product_id) {
        if quant.organization_id != organization_id || quant.company_id != company_id {
            continue;
        }
        if quant.quantity <= 0.0 {
            continue;
        }

        total_qty += quant.quantity;
        total_value += quant.value;
    }

    if total_qty <= 0.0 {
        0.0
    } else {
        (total_value / total_qty) * required_qty
    }
}

fn compute_fifo_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    required_qty: f64,
) -> f64 {
    if required_qty <= 0.0 {
        return 0.0;
    }

    let mut quants: Vec<_> = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id && q.company_id == company_id && q.quantity > 0.0
        })
        .collect();

    quants.sort_by_key(|q| q.in_date);

    let mut remaining = required_qty;
    let mut total_cost = 0.0f64;

    for quant in quants {
        if remaining <= 0.0 {
            break;
        }

        let take_qty = remaining.min(quant.quantity);
        let unit_cost = if quant.quantity.abs() > f64::EPSILON {
            quant.value / quant.quantity
        } else {
            quant.cost
        };

        total_cost += take_qty * unit_cost;
        remaining -= take_qty;
    }

    total_cost
}

fn compute_lifo_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    required_qty: f64,
) -> f64 {
    if required_qty <= 0.0 {
        return 0.0;
    }

    let mut quants: Vec<_> = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id && q.company_id == company_id && q.quantity > 0.0
        })
        .collect();

    quants.sort_by_key(|q| q.in_date);
    quants.reverse();

    let mut remaining = required_qty;
    let mut total_cost = 0.0f64;

    for quant in quants {
        if remaining <= 0.0 {
            break;
        }

        let take_qty = remaining.min(quant.quantity);
        let unit_cost = if quant.quantity.abs() > f64::EPSILON {
            quant.value / quant.quantity
        } else {
            quant.cost
        };

        total_cost += take_qty * unit_cost;
        remaining -= take_qty;
    }

    total_cost
}

fn resolve_cost_for_line(
    ctx: &ReducerContext,
    line: &AccountMoveLine,
    organization_id: u64,
    company_id: u64,
) -> f64 {
    let product_id = match line.product_id {
        Some(id) => id,
        None => return 0.0,
    };

    let product = match ctx.db.product().id().find(&product_id) {
        Some(p) => p,
        None => return 0.0,
    };

    match product.cost_method.as_str() {
        "fifo" => compute_fifo_cost(ctx, organization_id, company_id, product_id, line.quantity),
        "lifo" => compute_lifo_cost(ctx, organization_id, company_id, product_id, line.quantity),
        "average" | "weighted_average" => compute_weighted_average_cost(
            ctx,
            organization_id,
            company_id,
            product_id,
            line.quantity,
        ),
        _ => line.quantity * product.standard_price,
    }
}

fn post_cogs_entries(
    ctx: &ReducerContext,
    organization_id: u64,
    move_record: &AccountMove,
    cogs_account_id: u64,
    inventory_account_id: u64,
) -> Result<(), String> {
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .collect();

    let mut sequence: u32 = lines.iter().map(|l| l.sequence).max().unwrap_or(0) + 1;
    let mut total_cogs = 0.0f64;

    for line in lines {
        let cost = resolve_cost_for_line(ctx, &line, organization_id, move_record.company_id);
        if cost <= 0.0 {
            continue;
        }

        total_cogs += cost;

        ctx.db.account_move_line().id().update(AccountMoveLine {
            cogs_amount: cost,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });
    }

    if total_cogs <= 0.0 {
        return Ok(());
    }

    let cogs_line = AccountMoveLine {
        id: 0,
        move_id: move_record.id,
        move_name: Some(move_record.name.clone()),
        date: move_record.date,
        ref_: move_record.ref_.clone(),
        parent_state: move_record.state.clone(),
        journal_id: move_record.journal_id,
        company_id: move_record.company_id,
        company_currency_id: move_record.company_currency_id,
        sequence,
        name: "Cost of Goods Sold".to_string(),
        quantity: 1.0,
        price_unit: total_cogs,
        price: total_cogs,
        price_subtotal: total_cogs,
        price_total: total_cogs,
        discount: 0.0,
        balance: total_cogs,
        currency_id: move_record.currency_id,
        amount_currency: total_cogs,
        amount_residual: 0.0,
        amount_residual_currency: 0.0,
        debit: total_cogs,
        credit: 0.0,
        debit_currency: total_cogs,
        credit_currency: 0.0,
        tax_base_amount: 0.0,
        account_id: cogs_account_id,
        account_internal_type: Some("Expense".to_string()),
        account_internal_group: Some("Expense".to_string()),
        account_root_id: None,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_ids: vec![],
        tax_repartition_line_id: None,
        tax_audit: None,
        partner_id: move_record.partner_id,
        commercial_partner_id: move_record.commercial_partner_id,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        currency_id_field: Some(move_record.currency_id),
        blocked: false,
        matching_number: None,
        matching_label: None,
        is_matching: false,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: true,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        cogs_amount: total_cogs,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some("{\"auto_generated\":\"cogs_debit\"}".to_string()),
    };
    ctx.db.account_move_line().insert(cogs_line);

    sequence += 1;

    let inventory_line = AccountMoveLine {
        id: 0,
        move_id: move_record.id,
        move_name: Some(move_record.name.clone()),
        date: move_record.date,
        ref_: move_record.ref_.clone(),
        parent_state: move_record.state.clone(),
        journal_id: move_record.journal_id,
        company_id: move_record.company_id,
        company_currency_id: move_record.company_currency_id,
        sequence,
        name: "Inventory Valuation".to_string(),
        quantity: 1.0,
        price_unit: total_cogs,
        price: total_cogs,
        price_subtotal: total_cogs,
        price_total: total_cogs,
        discount: 0.0,
        balance: -total_cogs,
        currency_id: move_record.currency_id,
        amount_currency: -total_cogs,
        amount_residual: 0.0,
        amount_residual_currency: 0.0,
        debit: 0.0,
        credit: total_cogs,
        debit_currency: 0.0,
        credit_currency: total_cogs,
        tax_base_amount: 0.0,
        account_id: inventory_account_id,
        account_internal_type: Some("Asset".to_string()),
        account_internal_group: Some("Asset".to_string()),
        account_root_id: None,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_ids: vec![],
        tax_repartition_line_id: None,
        tax_audit: None,
        partner_id: move_record.partner_id,
        commercial_partner_id: move_record.commercial_partner_id,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        currency_id_field: Some(move_record.currency_id),
        blocked: false,
        matching_number: None,
        matching_label: None,
        is_matching: false,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: true,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        cogs_amount: total_cogs,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some("{\"auto_generated\":\"cogs_credit\"}".to_string()),
    };
    ctx.db.account_move_line().insert(inventory_line);

    Ok(())
}

#[spacetimedb::reducer]
pub fn compute_invoice_totals(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    match move_record.move_type {
        MoveType::OutInvoice | MoveType::InInvoice | MoveType::OutRefund | MoveType::InRefund => {}
        _ => {
            return Err("compute_invoice_totals is only valid for invoice/refund moves".to_string())
        }
    }

    compute_invoice_totals_internal(ctx, move_id)?;

    write_audit_log(
        ctx,
        organization_id,
        Some(move_record.company_id),
        "account_move",
        move_id,
        "COMPUTE_TOTALS",
        None,
        None,
        vec![
            "amount_untaxed".to_string(),
            "amount_tax".to_string(),
            "amount_total".to_string(),
        ],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn post_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    cogs_account_id: u64,
    inventory_account_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice not found")?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Invoice is not in draft state".to_string());
    }

    match move_record.move_type {
        MoveType::OutInvoice | MoveType::InInvoice | MoveType::OutRefund | MoveType::InRefund => {}
        _ => return Err("post_invoice is only valid for invoice/refund moves".to_string()),
    }

    compute_invoice_totals_internal(ctx, move_id)?;
    post_cogs_entries(
        ctx,
        organization_id,
        &move_record,
        cogs_account_id,
        inventory_account_id,
    )?;

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() > 0.01 {
        return Err("Invoice move is not balanced after COGS posting".to_string());
    }

    let name = if move_record.name.is_empty() {
        format!("INV{}/{}", move_record.journal_id, move_id)
    } else {
        move_record.name.clone()
    };

    for line in lines {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Posted,
            move_name: Some(name.clone()),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });
    }

    let refreshed = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice not found after totals computation")?;

    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        name,
        posted_before: true,
        payment_state: PaymentState::NotPaid,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..refreshed
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(move_record.company_id),
        "account_move",
        move_id,
        "POST_INVOICE",
        Some(serde_json::json!({ "state": "Draft" }).to_string()),
        Some(serde_json::json!({ "state": "Posted" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_move(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    journal_id: u64,
    move_type: MoveType,
    date: Timestamp,
    ref_: Option<String>,
    partner_id: Option<u64>,
    partner_bank_id: Option<u64>,
    fiscal_position_id: Option<u64>,
    invoice_date: Option<Timestamp>,
    invoice_date_due: Option<Timestamp>,
    invoice_payment_term_id: Option<u64>,
    payment_reference: Option<String>,
    invoice_origin: Option<String>,
    invoice_partner_display_name: Option<String>,
    invoice_cash_rounding_id: Option<u64>,
    partner_shipping_id: Option<u64>,
    sale_order_id: Option<u64>,
    invoice_incoterm_id: Option<u64>,
    incoterm_location: Option<String>,
    campaign_id: Option<u64>,
    source_id: Option<u64>,
    medium_id: Option<u64>,
    secure_sequence_number: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;

    // Validate journal exists and belongs to company
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("Journal not found")?;

    if journal.company_id != company_id {
        return Err("Journal does not belong to the specified company".to_string());
    }

    // Get company for currency
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    // Clone values for audit log before insert
    let move_type_str = format!("{:?}", move_type);
    let date_str = date.to_string();

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        name: String::new(), // Will be generated on post
        ref_,
        move_type,
        auto_post: false,
        state: AccountMoveState::Draft,
        date,
        invoice_date,
        invoice_date_due,
        invoice_payment_term_id,
        invoice_origin,
        invoice_partner_display_name,
        invoice_cash_rounding_id,
        payment_reference,
        partner_shipping_id,
        sale_order_id,
        partner_id,
        commercial_partner_id: partner_id,
        partner_bank_id,
        fiscal_position_id,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id,
        incoterm_location,
        campaign_id,
        source_id,
        medium_id,
        company_id,
        journal_id,
        currency_id: journal.currency_id.unwrap_or(company.currency_id),
        company_currency_id: company.currency_id,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_residual: 0.0,
        amount_untaxed_signed: 0.0,
        amount_tax_signed: 0.0,
        amount_total_signed: 0.0,
        amount_total_in_currency_signed: 0.0,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: journal.restrict_mode_hash_table,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_move",
        move_record.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "move_type": move_type_str, "date": date_str }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn add_account_move_line(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    account_id: u64,
    name: String,
    debit: f64,
    credit: f64,
    partner_id: Option<u64>,
    product_id: Option<u64>,
    quantity: Option<f64>,
    price_unit: Option<f64>,
    discount: Option<f64>,
    tax_ids: Vec<u64>,
    analytic_account_id: Option<u64>,
    analytic_tag_ids: Vec<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "create")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Cannot add lines to a posted move".to_string());
    }

    // Validate account exists
    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("Account not found")?;

    let balance = debit - credit;

    let qty = quantity.unwrap_or(1.0);
    let unit_price = price_unit.unwrap_or(0.0);
    let discount_pct = discount.unwrap_or(0.0);
    let subtotal = qty * unit_price * (1.0 - discount_pct / 100.0);
    let total = subtotal; // Tax would be added separately

    let line = ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        move_id,
        move_name: Some(move_record.name.clone()),
        date: move_record.date,
        ref_: move_record.ref_.clone(),
        parent_state: move_record.state,
        journal_id: move_record.journal_id,
        company_id: move_record.company_id,
        company_currency_id: move_record.company_currency_id,
        sequence: 0,
        name: name.clone(),
        quantity: qty,
        price_unit: unit_price,
        price: subtotal,
        price_subtotal: subtotal,
        price_total: total,
        discount: discount_pct,
        balance,
        currency_id: move_record.currency_id,
        amount_currency: balance,
        amount_residual: balance,
        amount_residual_currency: balance,
        debit,
        credit,
        debit_currency: debit,
        credit_currency: credit,
        tax_base_amount: 0.0,
        account_id,
        account_internal_type: account.internal_type.as_ref().map(|t| format!("{:?}", t)),
        account_internal_group: account.internal_group.as_ref().map(|g| format!("{:?}", g)),
        account_root_id: account.root_id,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_ids,
        tax_repartition_line_id: None,
        tax_audit: None,
        partner_id,
        commercial_partner_id: partner_id,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        currency_id_field: Some(move_record.currency_id),
        blocked: false,
        matching_number: None,
        matching_label: None,
        is_matching: false,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: false,
        analytic_account_id,
        analytic_tag_ids,
        product_id,
        product_uom_id: None,
        product_category_id: None,
        cogs_amount: 0.0,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(move_record.company_id),
        "account_move_line",
        line.id,
        "CREATE",
        None,
        Some(format!(
            "{{ \"name\": \"{}\", \"debit\": {}, \"credit\": {} }}",
            name, debit, credit
        )),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn post_account_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Only draft moves can be posted".to_string());
    }

    // Check balance - sum of debit must equal sum of credit
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() > 0.01 {
        return Err("Move is not balanced".to_string());
    }

    // Check that there are lines
    if lines.is_empty() {
        return Err("Cannot post a move without lines".to_string());
    }

    // Generate name from journal sequence if not set
    let name = if move_record.name.is_empty() {
        format!("M{}/{}", move_record.journal_id, move_id)
    } else {
        move_record.name.clone()
    };

    // Update all lines to posted state
    for line in lines {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Posted,
            move_name: Some(name.clone()),
            ..line
        });
    }

    // Update move to posted
    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        name,
        posted_before: true,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(move_record.company_id),
        "account_move",
        move_id,
        "POST",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_account_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    if move_record.state != AccountMoveState::Draft && move_record.state != AccountMoveState::Posted
    {
        return Err("Only draft or posted moves can be cancelled".to_string());
    }

    // Update all lines
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    for line in lines {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Cancelled,
            ..line
        });
    }

    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Cancelled,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(move_record.company_id),
        "account_move",
        move_id,
        "CANCEL",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_move_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    name: Option<String>,
    debit: Option<f64>,
    credit: Option<f64>,
    partner_id: Option<Option<u64>>,
    analytic_account_id: Option<Option<u64>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "write")?;

    let line = ctx
        .db
        .account_move_line()
        .id()
        .find(&line_id)
        .ok_or("Move line not found")?;

    // Check parent move is draft
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&line.move_id)
        .ok_or("Parent move not found")?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Cannot edit lines of a posted move".to_string());
    }

    let new_debit = debit.unwrap_or(line.debit);
    let new_credit = credit.unwrap_or(line.credit);
    let new_balance = new_debit - new_credit;

    ctx.db.account_move_line().id().update(AccountMoveLine {
        name: name.unwrap_or(line.name),
        debit: new_debit,
        credit: new_credit,
        balance: new_balance,
        amount_currency: new_balance,
        amount_residual: new_balance,
        amount_residual_currency: new_balance,
        debit_currency: new_debit,
        credit_currency: new_credit,
        partner_id: partner_id.unwrap_or(line.partner_id),
        analytic_account_id: analytic_account_id.unwrap_or(line.analytic_account_id),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(line.metadata),
        ..line
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(move_record.company_id),
        "account_move_line",
        line_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_account_move_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "delete")?;

    let line = ctx
        .db
        .account_move_line()
        .id()
        .find(&line_id)
        .ok_or("Move line not found")?;

    // Check parent move is draft
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&line.move_id)
        .ok_or("Parent move not found")?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Cannot delete lines from a posted move".to_string());
    }

    ctx.db.account_move_line().id().delete(&line_id);

    write_audit_log(
        ctx,
        organization_id,
        Some(move_record.company_id),
        "account_move_line",
        line_id,
        "DELETE",
        None,
        None,
        vec![],
    );

    Ok(())
}
