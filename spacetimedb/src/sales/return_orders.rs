/// Sales Return Orders (RMA) — customer return workflow
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_journal;
use crate::accounting::journal_entries::{
    account_move, insert_draft_account_move_line, AccountMove, AddAccountMoveLineParams,
};
use crate::core::organization::company;
use crate::crm::contacts::contact;
use crate::helpers::{
    calculate_tax, check_permission, next_doc_number, write_audit_log_v2, AuditLogParams,
};
use crate::inventory::product::product;
use crate::inventory::stock::{create_stock_move, create_stock_picking, stock_picking, CreateStockMoveParams, CreateStockPickingParams};
use crate::inventory::warehouse::warehouse;
use crate::sales::sales_core::{sale_order, sale_order_line};
use crate::types::{AccountMoveState, MoveType, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = return_order,
    public,
    index(accessor = return_order_by_company, btree(columns = [company_id]))
)]
pub struct ReturnOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub sale_order_id: Option<u64>,
    pub partner_id: u64,
    pub state: String,
    pub return_reason: Option<String>,
    pub picking_id: Option<u64>,
    pub credit_move_id: Option<u64>,
    pub line_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[spacetimedb::table(
    accessor = return_order_line,
    public,
    index(accessor = return_line_by_order, btree(columns = [return_order_id]))
)]
pub struct ReturnOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub return_order_id: u64,
    pub sale_order_line_id: Option<u64>,
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub price_unit: f64,
    pub to_refund: bool,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateReturnOrderLineParams {
    pub sale_order_line_id: Option<u64>,
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub price_unit: f64,
    pub to_refund: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateReturnOrderParams {
    pub sale_order_id: Option<u64>,
    pub partner_id: u64,
    pub return_reason: Option<String>,
    pub lines: Vec<CreateReturnOrderLineParams>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateReturnOrderParams {
    pub return_reason: Option<String>,
    pub state: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCreditNoteFromReturnOrderParams {
    pub journal_id: u64,
    pub default_income_account_id: u64,
    pub receivable_line: AddAccountMoveLineParams,
    pub income_line: AddAccountMoveLineParams,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn load_return_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    return_order_id: u64,
) -> Result<ReturnOrder, String> {
    let record = ctx
        .db
        .return_order()
        .id()
        .find(&return_order_id)
        .ok_or("Return order not found")?;

    if record.organization_id != organization_id {
        return Err("Return order does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    Ok(record)
}

fn return_lines_for_order(ctx: &ReducerContext, return_order_id: u64) -> Vec<ReturnOrderLine> {
    ctx.db
        .return_order_line()
        .return_line_by_order()
        .filter(&return_order_id)
        .collect()
}

fn validate_return_lines_against_sale_order(
    ctx: &ReducerContext,
    sale_order_id: u64,
    lines: &[CreateReturnOrderLineParams],
) -> Result<(), String> {
    for line in lines {
        if line.product_uom_qty <= 0.0 {
            return Err("Return quantity must be greater than zero".to_string());
        }
        if let Some(sol_id) = line.sale_order_line_id {
            let sol = ctx
                .db
                .sale_order_line()
                .id()
                .find(&sol_id)
                .ok_or("Sale order line not found")?;
            if sol.order_id != sale_order_id {
                return Err("Sale order line does not belong to the source sale order".to_string());
            }
            let already_returned: f64 = ctx
                .db
                .return_order_line()
                .iter()
                .filter(|r| r.sale_order_line_id == Some(sol_id))
                .map(|r| r.product_uom_qty)
                .sum();
            let residual = (sol.qty_delivered - already_returned).max(0.0);
            if line.product_uom_qty > residual + f64::EPSILON {
                return Err(format!(
                    "Return quantity {} exceeds residual delivered quantity {} on sale order line {} (delivered {}, already returned {})",
                    line.product_uom_qty, residual, sol_id, sol.qty_delivered, already_returned
                ));
            }
        }
    }
    Ok(())
}

fn create_return_picking_for_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    return_order: &ReturnOrder,
    lines: &[ReturnOrderLine],
) -> Result<u64, String> {
    let warehouse_id = if let Some(so_id) = return_order.sale_order_id {
        ctx.db
            .sale_order()
            .id()
            .find(&so_id)
            .ok_or("Sale order not found for return picking")?
            .warehouse_id
    } else {
        ctx.db
            .warehouse()
            .iter()
            .find(|w| w.organization_id == organization_id && w.company_id == company_id)
            .ok_or("No warehouse found for return picking")?
            .id
    };

    let stock_location =
        crate::inventory::stock::resolve_warehouse_stock_location(ctx, warehouse_id);
    let customer_location = stock_location.saturating_add(1);
    let order_label = return_order.name.clone();

    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: format!("RET/{order_label}"),
            picking_type_id: 1,
            location_id: customer_location,
            location_dest_id: stock_location,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(return_order.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("RMA/{order_label}")),
            note: return_order.return_reason.clone(),
            user_id: None,
            sale_id: return_order.sale_order_id,
            purchase_id: None,
            group_id: None,
            is_locked: false,
            immediate_transfer: false,
            is_printed: false,
            is_return: true,
            has_scrap_move: false,
            has_tracking: false,
            date: None,
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: false,
            show_lots_text: false,
            show_reserved: false,
            show_check_availability: true,
            show_validate: false,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: lines.first().map(|l| l.product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("incoming".to_string()),
            product_tracking: None,
            product_barcode: None,
            move_line_exist: false,
            has_packages: false,
            has_move_lines: false,
            has_package: false,
            has_lot: false,
            has_owner: false,
            has_entire_package_src: false,
            has_entire_package_dest: false,
            package_level_ids: vec![],
            batch_id: None,
            metadata: Some(format!(r#"{{"return_order_id":{}}}"#, return_order.id)),
        },
    )?;

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| {
            p.organization_id == organization_id
                && p.is_return
                && p.metadata
                    .as_deref()
                    .is_some_and(|m: &str| {
                        m.contains(&format!("\"return_order_id\":{}", return_order.id))
                    })
        })
        .ok_or("Return picking not found after create")?;

    for (idx, line) in lines.iter().enumerate() {
        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found for return line")?;

        create_stock_move(
            ctx,
            organization_id,
            CreateStockMoveParams {
                company_id: Some(company_id),
                name: format!("{} x {}", line.product_uom_qty, product.name),
                product_id: line.product_id,
                product_tmpl_id: line.product_id,
                product_uom: line.product_uom,
                product_uom_qty: line.product_uom_qty,
                location_id: customer_location,
                location_dest_id: stock_location,
                date_expected: ctx.timestamp,
                move_type: "incoming".to_string(),
                priority: "1".to_string(),
                reference: Some(format!("RMA/{order_label}")),
                sequence: ((idx + 1) as i32) * 10,
                origin: Some(format!("RMA/{order_label}")),
                note: return_order.return_reason.clone(),
                date: None,
                date_deadline: None,
                picking_id: Some(picking.id),
                picking_type_id: Some(1),
                partner_id: Some(return_order.partner_id),
                product_variant_id: None,
                group_id: None,
                rule_id: None,
                procure_method: "make_to_stock".to_string(),
                price_unit: line.price_unit,
                scrapped: false,
                to_refund: line.to_refund,
                propagate_cancel: true,
                delay_alert: false,
                product_packaging_id: None,
                product_packaging_qty: 0.0,
                warehouse_id: Some(warehouse_id),
                production_id: None,
                raw_material_production_id: None,
                unbuild_id: None,
                consume_unbuild_id: None,
                cost_share: 0.0,
                is_subcontract: false,
                purchase_line_id: None,
                need_release: false,
                release_ready: false,
                propagation_cancel: true,
                has_tracking: false,
                inventory_id: None,
                sale_line_id: line.sale_order_line_id,
                lot_id: None,
                serial_id: None,
                package_id: None,
                result_package_id: None,
                owner_id: None,
                package_level_id: None,
                product_type: Some("product".to_string()),
                metadata: None,
            },
        )?;
    }

    Ok(picking.id)
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_return_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateReturnOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "create")?;

    if params.lines.is_empty() {
        return Err("Return order must have at least one line".to_string());
    }

    ctx.db
        .contact()
        .id()
        .find(&params.partner_id)
        .ok_or("Partner not found")?;

    if let Some(so_id) = params.sale_order_id {
        let order = ctx
            .db
            .sale_order()
            .id()
            .find(&so_id)
            .ok_or("Sale order not found")?;
        if order.organization_id != organization_id {
            return Err("Sale order does not belong to this organization".to_string());
        }
        if order.company_id != company_id {
            return Err("Record does not belong to this company".to_string());
        }
        if order.partner_id != params.partner_id {
            return Err("Partner does not match the source sale order".to_string());
        }
        validate_return_lines_against_sale_order(ctx, so_id, &params.lines)?;
    }

    let name = next_doc_number(ctx, "RMA");

    let return_order = ctx.db.return_order().insert(ReturnOrder {
        id: 0,
        organization_id,
        company_id,
        name,
        sale_order_id: params.sale_order_id,
        partner_id: params.partner_id,
        state: "draft".to_string(),
        return_reason: params.return_reason.clone(),
        picking_id: None,
        credit_move_id: None,
        line_ids: vec![],
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    let mut line_ids = Vec::with_capacity(params.lines.len());
    for line in &params.lines {
        ctx.db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found")?;

        let row = ctx.db.return_order_line().insert(ReturnOrderLine {
            id: 0,
            organization_id,
            company_id,
            return_order_id: return_order.id,
            sale_order_line_id: line.sale_order_line_id,
            product_id: line.product_id,
            product_uom: line.product_uom,
            product_uom_qty: line.product_uom_qty,
            price_unit: line.price_unit,
            to_refund: line.to_refund,
        });
        line_ids.push(row.id);
    }

    let return_order_id = return_order.id;
    let return_order_name = return_order.name.clone();

    ctx.db.return_order().id().update(ReturnOrder {
        line_ids,
        ..return_order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "return_order",
            record_id: return_order_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": return_order_name,
                    "partner_id": params.partner_id,
                    "sale_order_id": params.sale_order_id,
                    "line_count": params.lines.len(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "partner_id".to_string(),
                "state".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn confirm_return_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    return_order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;

    let return_order = load_return_order(ctx, organization_id, company_id, return_order_id)?;

    if return_order.state != "draft" {
        return Err("Only draft return orders can be confirmed".to_string());
    }

    let lines = return_lines_for_order(ctx, return_order_id);
    if lines.is_empty() {
        return Err("Return order has no lines".to_string());
    }

    if let Some(so_id) = return_order.sale_order_id {
        let line_params: Vec<CreateReturnOrderLineParams> = lines
            .iter()
            .map(|l| CreateReturnOrderLineParams {
                sale_order_line_id: l.sale_order_line_id,
                product_id: l.product_id,
                product_uom: l.product_uom,
                product_uom_qty: l.product_uom_qty,
                price_unit: l.price_unit,
                to_refund: l.to_refund,
            })
            .collect();
        validate_return_lines_against_sale_order(ctx, so_id, &line_params)?;
    }

    let picking_id = create_return_picking_for_order(
        ctx,
        organization_id,
        company_id,
        &return_order,
        &lines,
    )?;

    let old_state = return_order.state.clone();
    ctx.db.return_order().id().update(ReturnOrder {
        picking_id: Some(picking_id),
        state: "confirmed".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..return_order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "return_order",
            record_id: return_order_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "confirmed",
                    "picking_id": picking_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string(), "picking_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn cancel_return_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    return_order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;

    let return_order = load_return_order(ctx, organization_id, company_id, return_order_id)?;

    if return_order.state == "cancelled" {
        return Ok(());
    }
    if return_order.state == "received" || return_order.state == "refunded" {
        return Err("Cannot cancel a received or refunded return order".to_string());
    }

    let old_state = return_order.state.clone();
    ctx.db.return_order().id().update(ReturnOrder {
        state: "cancelled".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..return_order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "return_order",
            record_id: return_order_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "cancelled" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_credit_note_from_return_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    return_order_id: u64,
    params: CreateCreditNoteFromReturnOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;

    let return_order = load_return_order(ctx, organization_id, company_id, return_order_id)?;

    if return_order.state != "received" {
        return Err("Return order must be received before creating a credit note".to_string());
    }
    if return_order.credit_move_id.is_some() {
        return Err("Credit note already linked to this return order".to_string());
    }

    let refund_lines: Vec<_> = return_lines_for_order(ctx, return_order_id)
        .into_iter()
        .filter(|l| l.to_refund)
        .collect();

    if refund_lines.is_empty() {
        return Err("No return lines marked for refund".to_string());
    }

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;

    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let partner_invoice_id = return_order
        .sale_order_id
        .and_then(|so_id| ctx.db.sale_order().id().find(&so_id))
        .map(|so| so.partner_invoice_id)
        .unwrap_or(return_order.partner_id);

    let partner_display_name = ctx
        .db
        .contact()
        .id()
        .find(&partner_invoice_id)
        .map(|c| c.display_name.clone());

    let currency_id = return_order
        .sale_order_id
        .and_then(|so_id| ctx.db.sale_order().id().find(&so_id))
        .map(|so| so.currency_id)
        .unwrap_or_else(|| journal.currency_id.unwrap_or(company.currency_id));

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: None,
        move_type: MoveType::OutRefund,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("RMA{}", return_order_id)),
        invoice_partner_display_name: partner_display_name.clone(),
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: None,
        sale_order_id: return_order.sale_order_id,
        partner_id: Some(partner_invoice_id),
        commercial_partner_id: Some(partner_invoice_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: params.journal_id,
        currency_id,
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
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: journal.restrict_mode_hash_table,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone().or_else(|| {
            return_order
                .return_reason
                .clone()
                .map(|r| format!(r#"{{"return_order_id":{return_order_id},"reason":"{r}"}}"#))
        }),
    });

    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;

    for (seq, line) in refund_lines.iter().enumerate() {
        let qty = line.product_uom_qty;
        let subtotal = qty * line.price_unit;
        let tax_ids = return_order
            .sale_order_id
            .and_then(|_so_id| line.sale_order_line_id)
            .and_then(|sl_id| ctx.db.sale_order_line().id().find(&sl_id))
            .map(|sol| sol.tax_id.clone())
            .unwrap_or_default();
        let tax_amount = calculate_tax(ctx, &tax_ids, subtotal);

        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found")?;

        let mut line_params = params.income_line.clone();
        line_params.account_id = params.default_income_account_id;
        line_params.name = product.name.clone();
        line_params.debit = subtotal;
        line_params.credit = 0.0;
        line_params.sequence = seq as u32;
        line_params.quantity = qty;
        line_params.price_unit = line.price_unit;
        line_params.tax_ids = tax_ids;
        if line_params.partner_id.is_none() {
            line_params.partner_id = Some(partner_invoice_id);
        }
        line_params.product_id = Some(line.product_id);
        line_params.product_uom_id = Some(line.product_uom);

        insert_draft_account_move_line(ctx, &move_record, line_params)?;

        amount_untaxed += subtotal;
        amount_tax += tax_amount;
    }

    let amount_total = amount_untaxed + amount_tax;

    let mut receivable_params = params.receivable_line.clone();
    receivable_params.debit = 0.0;
    receivable_params.credit = amount_total;
    receivable_params.sequence = refund_lines.len() as u32;
    receivable_params.quantity = 1.0;
    receivable_params.price_unit = amount_total;
    if receivable_params.name.is_empty() {
        receivable_params.name = partner_display_name
            .clone()
            .unwrap_or_else(|| "Accounts Receivable".to_string());
    }
    if receivable_params.partner_id.is_none() {
        receivable_params.partner_id = Some(partner_invoice_id);
    }
    insert_draft_account_move_line(ctx, &move_record, receivable_params)?;

    ctx.db.account_move().id().update(AccountMove {
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record.clone()
    });

    let old_state = return_order.state.clone();
    let clawback_sale_order_id = return_order.sale_order_id;
    ctx.db.return_order().id().update(ReturnOrder {
        credit_move_id: Some(move_record.id),
        state: "refunded".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..return_order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: move_record.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "move_type": "OutRefund",
                    "return_order_id": return_order_id,
                    "amount_total": amount_total,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "move_type".to_string(),
                "return_order_id".to_string(),
                "amount_total".to_string(),
            ],
            metadata: None,
        },
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "return_order",
            record_id: return_order_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "state": old_state,
                    "credit_move_id": null,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "state": "refunded",
                    "credit_move_id": move_record.id,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string(), "credit_move_id".to_string()],
            metadata: None,
        },
    );

    if let Some(sale_order_id) = clawback_sale_order_id {
        crate::sales::oms_extensions::cancel_accrued_commissions_for_sale_order(
            ctx,
            organization_id,
            sale_order_id,
            "credit_note_from_return",
        )?;
    }

    Ok(())
}
