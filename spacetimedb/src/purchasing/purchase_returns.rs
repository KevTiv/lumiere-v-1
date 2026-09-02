/// Purchase returns (vendor RMA) — create → confirm (OUT picking) → AP credit stub.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{
    account_move, insert_draft_account_move_line, AccountMove, AddAccountMoveLineParams,
};
use crate::accounting::relations::{
    require_active_account, require_active_journal, require_contact_in_scope,
};
use crate::core::organization::{company, require_company_in_organization};
use crate::core::reference::uom;
use crate::crm::contacts::contact;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::inventory::stock::{
    create_stock_move, create_stock_picking, stock_picking, CreateStockMoveParams,
    CreateStockPickingParams,
};
use crate::inventory::warehouse::warehouse;
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line};
use crate::types::{
    AccountInternalGroup, AccountMoveState, AccountTypeInternal, JournalType, MoveType,
    PaymentState, PoState,
};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = purchase_return,
    public,
    index(accessor = purchase_return_by_organization, btree(columns = [organization_id])),
    index(accessor = purchase_return_by_company, btree(columns = [company_id]))
)]
pub struct PurchaseReturn {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub purchase_order_id: Option<u64>,
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
    accessor = purchase_return_line,
    public,
    index(accessor = purchase_return_line_by_organization, btree(columns = [organization_id])),
    index(accessor = purchase_return_line_by_return, btree(columns = [purchase_return_id]))
)]
pub struct PurchaseReturnLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub purchase_return_id: u64,
    pub purchase_order_line_id: Option<u64>,
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub price_unit: f64,
    pub to_refund: bool,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseReturnLineParams {
    pub purchase_order_line_id: Option<u64>,
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub price_unit: f64,
    pub to_refund: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseReturnParams {
    pub purchase_order_id: Option<u64>,
    pub partner_id: u64,
    pub return_reason: Option<String>,
    pub lines: Vec<CreatePurchaseReturnLineParams>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateVendorCreditFromPurchaseReturnParams {
    pub journal_id: u64,
    pub expense_account_id: u64,
    pub payable_account_id: u64,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn load_purchase_return(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    purchase_return_id: u64,
) -> Result<PurchaseReturn, String> {
    let record = ctx
        .db
        .purchase_return()
        .id()
        .find(&purchase_return_id)
        .ok_or("Purchase return not found")?;
    if record.organization_id != organization_id {
        return Err("Purchase return does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    Ok(record)
}

fn return_lines_for(ctx: &ReducerContext, purchase_return_id: u64) -> Vec<PurchaseReturnLine> {
    ctx.db
        .purchase_return_line()
        .purchase_return_line_by_return()
        .filter(&purchase_return_id)
        .collect()
}

fn require_return_product_and_uom(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    uom_id: u64,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Return product not found")?;
    if product.organization_id != organization_id {
        return Err("Return product does not belong to this organization".to_string());
    }
    if !product.active || !product.purchase_ok {
        return Err("Return product is inactive or not purchasable".to_string());
    }
    let uom = ctx
        .db
        .uom()
        .id()
        .find(&uom_id)
        .ok_or("Return UoM not found")?;
    if uom.organization_id != organization_id || !uom.is_active {
        return Err("Return UoM is outside the organization or inactive".to_string());
    }
    if uom_id != product.uom_id && uom_id != product.uom_po_id {
        return Err("Return UoM is incompatible with the product".to_string());
    }
    Ok(())
}

fn already_returned_quantity(ctx: &ReducerContext, purchase_order_line_id: u64) -> f64 {
    ctx.db
        .purchase_return_line()
        .iter()
        .filter(|line| line.purchase_order_line_id == Some(purchase_order_line_id))
        .filter(|line| {
            ctx.db
                .purchase_return()
                .id()
                .find(&line.purchase_return_id)
                .is_some_and(|parent| parent.state != "cancelled")
        })
        .map(|line| line.product_uom_qty)
        .sum()
}

fn source_return_warehouse(
    ctx: &ReducerContext,
    purchase_return: &PurchaseReturn,
) -> Result<u64, String> {
    let purchase_order_id = purchase_return.purchase_order_id.ok_or(
        "Unsourced purchase returns cannot be confirmed until a warehouse selector is supported",
    )?;
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&purchase_order_id)
        .ok_or("Source purchase order not found")?;
    if order.organization_id != purchase_return.organization_id
        || order.company_id != purchase_return.company_id
    {
        return Err("Source purchase order scope does not match the return".to_string());
    }
    let receipt = ctx
        .db
        .stock_picking()
        .iter()
        .find(|picking| {
            picking.organization_id == purchase_return.organization_id
                && picking.company_id == purchase_return.company_id
                && picking.purchase_id == Some(purchase_order_id)
                && picking.picking_code.as_deref() == Some("incoming")
        })
        .ok_or("Source purchase order has no scoped incoming picking")?;
    ctx.db
        .warehouse()
        .iter()
        .find(|warehouse| {
            warehouse.organization_id == purchase_return.organization_id
                && warehouse.company_id == purchase_return.company_id
                && warehouse.is_active
                && [
                    Some(warehouse.lot_stock_id),
                    warehouse.wh_input_stock_loc_id,
                    warehouse.wh_qc_stock_loc_id,
                ]
                .contains(&Some(receipt.location_dest_id))
        })
        .map(|warehouse| warehouse.id)
        .ok_or_else(|| "Source receipt does not resolve to an active warehouse".to_string())
}

fn empty_move_line(account_id: u64, name: String) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name,
        debit: 0.0,
        credit: 0.0,
        sequence: 0,
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

fn create_outgoing_return_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    purchase_return: &PurchaseReturn,
    lines: &[PurchaseReturnLine],
) -> Result<u64, String> {
    let warehouse_id = source_return_warehouse(ctx, purchase_return)?;

    let stock_location =
        crate::inventory::stock::resolve_warehouse_stock_location(ctx, warehouse_id);
    let vendor_location =
        crate::inventory::stock::resolve_supplier_stock_location(ctx, organization_id, company_id)?;
    let order_label = purchase_return.name.clone();

    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: format!("PRET/{order_label}"),
            picking_type_id: 2,
            location_id: stock_location,
            location_dest_id: vendor_location,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(purchase_return.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("VRMA/{order_label}")),
            note: purchase_return.return_reason.clone(),
            user_id: None,
            sale_id: None,
            purchase_id: purchase_return.purchase_order_id,
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
            picking_code: Some("outgoing".to_string()),
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
            metadata: Some(format!(
                r#"{{"purchase_return_id":{}}}"#,
                purchase_return.id
            )),
        },
    )?;

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| {
            p.organization_id == organization_id
                && p.is_return
                && p.metadata.as_deref().is_some_and(|m: &str| {
                    m.contains(&format!("\"purchase_return_id\":{}", purchase_return.id))
                })
        })
        .ok_or("Purchase return picking not found after create")?;

    for (idx, line) in lines.iter().enumerate() {
        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found for purchase return line")?;

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
                location_id: stock_location,
                location_dest_id: vendor_location,
                date_expected: ctx.timestamp,
                move_type: "outgoing".to_string(),
                priority: "1".to_string(),
                reference: Some(format!("VRMA/{order_label}")),
                sequence: ((idx + 1) as i32) * 10,
                origin: Some(format!("VRMA/{order_label}")),
                note: purchase_return.return_reason.clone(),
                date: None,
                date_deadline: None,
                picking_id: Some(picking.id),
                picking_type_id: Some(2),
                partner_id: Some(purchase_return.partner_id),
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
                purchase_line_id: line.purchase_order_line_id,
                need_release: false,
                release_ready: false,
                propagation_cancel: true,
                has_tracking: false,
                inventory_id: None,
                sale_line_id: None,
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

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_purchase_return(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePurchaseReturnParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if params.lines.is_empty() {
        return Err("Purchase return must have at least one line".to_string());
    }

    let vendor = require_contact_in_scope(
        ctx,
        organization_id,
        company_id,
        params.partner_id,
        "purchase return vendor",
    )?;
    if !vendor.is_vendor || vendor.deleted_at.is_some() || vendor.merge_target_id.is_some() {
        return Err("Partner is not an active vendor".to_string());
    }

    let source_order = if let Some(po_id) = params.purchase_order_id {
        let order = ctx
            .db
            .purchase_order()
            .id()
            .find(&po_id)
            .ok_or("Purchase order not found")?;
        if order.organization_id != organization_id {
            return Err("Purchase order does not belong to this organization".to_string());
        }
        if order.company_id != company_id {
            return Err("Record does not belong to this company".to_string());
        }
        if order.partner_id != params.partner_id {
            return Err("Partner does not match the source purchase order".to_string());
        }
        if !matches!(order.state, PoState::Purchase | PoState::Done) {
            return Err("Source purchase order is not confirmed".to_string());
        }
        Some(order)
    } else {
        None
    };

    let mut validated_lines = Vec::with_capacity(params.lines.len());
    for line in &params.lines {
        if !line.product_uom_qty.is_finite() || line.product_uom_qty <= 0.0 {
            return Err("Return quantity must be a positive finite number".to_string());
        }
        if !line.price_unit.is_finite() || line.price_unit < 0.0 {
            return Err("Return price must be a non-negative finite number".to_string());
        }
        let validated = if let Some(pol_id) = line.purchase_order_line_id {
            let order = source_order
                .as_ref()
                .ok_or("A sourced return line requires a source purchase order")?;
            let source = ctx
                .db
                .purchase_order_line()
                .id()
                .find(&pol_id)
                .ok_or("Purchase order line not found")?;
            if source.organization_id != organization_id
                || source.company_id != company_id
                || source.order_id != order.id
            {
                return Err("Purchase order line does not belong to the source order scope".into());
            }
            if line.product_id != source.product_id
                || line.product_uom != source.product_uom
                || (line.price_unit - source.price_unit).abs() > 0.000_001
            {
                return Err("Sourced return product, UoM, and price must match the PO line".into());
            }
            let eligible = source.qty_received - already_returned_quantity(ctx, source.id);
            if line.product_uom_qty > eligible + 0.000_001 {
                return Err("Return quantity exceeds the eligible received quantity".into());
            }
            CreatePurchaseReturnLineParams {
                purchase_order_line_id: Some(source.id),
                product_id: source.product_id,
                product_uom: source.product_uom,
                product_uom_qty: line.product_uom_qty,
                price_unit: source.price_unit,
                to_refund: line.to_refund,
            }
        } else {
            require_return_product_and_uom(
                ctx,
                organization_id,
                line.product_id,
                line.product_uom,
            )?;
            line.clone()
        };
        validated_lines.push(validated);
    }

    let name = next_doc_number(ctx, organization_id, "VRMA");
    let purchase_return = ctx.db.purchase_return().insert(PurchaseReturn {
        id: 0,
        organization_id,
        company_id,
        name,
        purchase_order_id: params.purchase_order_id,
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
    for line in &validated_lines {
        let row = ctx.db.purchase_return_line().insert(PurchaseReturnLine {
            id: 0,
            organization_id,
            company_id,
            purchase_return_id: purchase_return.id,
            purchase_order_line_id: line.purchase_order_line_id,
            product_id: line.product_id,
            product_uom: line.product_uom,
            product_uom_qty: line.product_uom_qty,
            price_unit: line.price_unit,
            to_refund: line.to_refund,
        });
        line_ids.push(row.id);
    }

    let return_id = purchase_return.id;
    let return_name = purchase_return.name.clone();
    ctx.db.purchase_return().id().update(PurchaseReturn {
        line_ids,
        ..purchase_return
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_return",
            record_id: return_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": return_name,
                    "partner_id": params.partner_id,
                    "purchase_order_id": params.purchase_order_id,
                    "line_count": validated_lines.len(),
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

/// Confirm purchase return: create OUT picking to vendor (stock out).
#[reducer]
pub fn confirm_purchase_return(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    purchase_return_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let purchase_return =
        load_purchase_return(ctx, organization_id, company_id, purchase_return_id)?;
    if purchase_return.state != "draft" {
        return Err("Only draft purchase returns can be confirmed".to_string());
    }

    let lines = return_lines_for(ctx, purchase_return_id);
    if lines.is_empty() {
        return Err("Purchase return has no lines".to_string());
    }

    let picking_id =
        create_outgoing_return_picking(ctx, organization_id, company_id, &purchase_return, &lines)?;

    let old_state = purchase_return.state.clone();
    ctx.db.purchase_return().id().update(PurchaseReturn {
        picking_id: Some(picking_id),
        state: "confirmed".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..purchase_return
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_return",
            record_id: purchase_return_id,
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

/// Stub AP vendor credit (InRefund draft) linked to a confirmed purchase return.
#[reducer]
pub fn create_vendor_credit_from_purchase_return(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    purchase_return_id: u64,
    params: CreateVendorCreditFromPurchaseReturnParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let purchase_return =
        load_purchase_return(ctx, organization_id, company_id, purchase_return_id)?;
    if purchase_return.credit_move_id.is_some() {
        return Ok(());
    }
    if purchase_return.state != "confirmed" {
        return Err(
            "Purchase return must be confirmed before creating a vendor credit".to_string(),
        );
    }

    let refund_lines: Vec<_> = return_lines_for(ctx, purchase_return_id)
        .into_iter()
        .filter(|l| l.to_refund)
        .collect();
    if refund_lines.is_empty() {
        return Err("No purchase return lines marked for refund".to_string());
    }

    let journal = require_active_journal(
        ctx,
        organization_id,
        company_id,
        params.journal_id,
        "vendor credit",
    )?;
    if journal.type_ != JournalType::Purchase {
        return Err("Vendor credit requires an active purchase journal".to_string());
    }
    let expense_account = require_active_account(
        ctx,
        organization_id,
        company_id,
        params.expense_account_id,
        "vendor credit expense",
    )?;
    if expense_account.internal_group != Some(AccountInternalGroup::Expense) {
        return Err("Vendor credit expense account must have the expense role".to_string());
    }
    let payable_account = require_active_account(
        ctx,
        organization_id,
        company_id,
        params.payable_account_id,
        "vendor credit payable",
    )?;
    if payable_account.internal_type != Some(AccountTypeInternal::Payable) {
        return Err("Vendor credit payable account must have the payable role".to_string());
    }
    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let partner_display_name = ctx
        .db
        .contact()
        .id()
        .find(&purchase_return.partner_id)
        .map(|c| c.display_name.clone());

    let currency_id = purchase_return
        .purchase_order_id
        .and_then(|po_id| ctx.db.purchase_order().id().find(&po_id))
        .map(|po| po.currency_id)
        .unwrap_or_else(|| journal.currency_id.unwrap_or(company_row.currency_id));

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: None,
        move_type: MoveType::InRefund,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("VRMA{purchase_return_id}")),
        invoice_partner_display_name: partner_display_name.clone(),
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(purchase_return.partner_id),
        commercial_partner_id: Some(purchase_return.partner_id),
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
        company_currency_id: company_row.currency_id,
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
        metadata: params
            .metadata
            .clone()
            .or_else(|| Some(format!(r#"{{"purchase_return_id":{purchase_return_id}}}"#))),
    });

    let mut amount_untaxed = 0.0f64;
    for (seq, line) in refund_lines.iter().enumerate() {
        let qty = line.product_uom_qty;
        let subtotal = qty * line.price_unit;
        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found")?;

        let mut expense = empty_move_line(params.expense_account_id, product.name.clone());
        // Vendor credit (InRefund): credit expense, debit payable.
        expense.credit = subtotal;
        expense.debit = 0.0;
        expense.sequence = seq as u32;
        expense.quantity = qty;
        expense.price_unit = line.price_unit;
        expense.partner_id = Some(purchase_return.partner_id);
        expense.product_id = Some(line.product_id);
        expense.product_uom_id = Some(line.product_uom);
        insert_draft_account_move_line(ctx, &move_record, expense)?;
        amount_untaxed += subtotal;
    }

    let amount_total = amount_untaxed;
    let mut payable = empty_move_line(
        params.payable_account_id,
        partner_display_name
            .clone()
            .unwrap_or_else(|| "Accounts Payable".to_string()),
    );
    payable.debit = amount_total;
    payable.credit = 0.0;
    payable.sequence = refund_lines.len() as u32;
    payable.quantity = 1.0;
    payable.price_unit = amount_total;
    payable.partner_id = Some(purchase_return.partner_id);
    insert_draft_account_move_line(ctx, &move_record, payable)?;

    ctx.db.account_move().id().update(AccountMove {
        amount_untaxed,
        amount_tax: 0.0,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: 0.0,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record.clone()
    });

    let old_state = purchase_return.state.clone();
    ctx.db.purchase_return().id().update(PurchaseReturn {
        credit_move_id: Some(move_record.id),
        state: "refunded".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..purchase_return
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_return",
            record_id: purchase_return_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
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

    Ok(())
}
