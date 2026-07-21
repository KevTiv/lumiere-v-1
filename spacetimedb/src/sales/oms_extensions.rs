//! Sales OMS extensions — fiscal position tax maps, Incoterms, dropship POs,
//! SaleOrderOption CRUD, promotions, commissions, and exchange orders.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{account_move, account_move_line, AccountMove, AccountMoveLine};
use crate::core::organization::company;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::{product, product_supplier_info};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, create_purchase_order, purchase_order, AddPurchaseOrderLineParams,
    CreatePurchaseOrderParams,
};
use crate::sales::return_orders::{return_order, return_order_line};
use crate::sales::sales_core::{
    create_sale_order, sale_order, sale_order_line, sale_order_option, CreateSaleOrderLineParams,
    CreateSaleOrderParams, SaleOrder, SaleOrderOption,
};
use crate::types::{AccountMoveState, MoveType, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_fiscal_position,
    public,
    index(accessor = fiscal_position_by_org, btree(columns = [organization_id]))
)]
pub struct AccountFiscalPosition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub name: String,
    pub is_active: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_fiscal_position_tax,
    public,
    index(accessor = fiscal_tax_by_position, btree(columns = [fiscal_position_id]))
)]
pub struct AccountFiscalPositionTax {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub fiscal_position_id: u64,
    /// Source tax to match on the document line.
    pub tax_src_id: u64,
    /// Replacement tax; `None` removes the source tax.
    pub tax_dest_id: Option<u64>,
    pub sequence: u32,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_incoterm,
    public,
    index(accessor = incoterm_by_org, btree(columns = [organization_id]))
)]
pub struct AccountIncoterm {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = sale_promotion,
    public,
    index(accessor = promotion_by_org, btree(columns = [organization_id])),
    index(accessor = promotion_by_code, btree(columns = [code]))
)]
pub struct SalePromotion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub code: String,
    pub name: String,
    pub discount_percent: f64,
    pub discount_fixed: f64,
    pub min_amount: f64,
    pub is_active: bool,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = sale_commission,
    public,
    index(accessor = commission_by_org, btree(columns = [organization_id])),
    index(accessor = commission_by_order, btree(columns = [sale_order_id]))
)]
pub struct SaleCommission {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub sale_order_id: u64,
    pub salesperson_id: Identity,
    pub basis_amount: f64,
    pub rate_percent: f64,
    pub amount: f64,
    /// `accrued` | `settled` | `cancelled`
    pub state: String,
    /// Posted GL Entry move that settled this commission (expense / payable).
    pub settle_move_id: Option<u64>,
    pub settled_at: Option<Timestamp>,
    /// Groups commissions settled in the same batch (typically settle move id).
    pub settle_batch_id: Option<u64>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateFiscalPositionParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateFiscalPositionTaxParams {
    pub fiscal_position_id: u64,
    pub tax_src_id: u64,
    pub tax_dest_id: Option<u64>,
    pub sequence: u32,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateIncotermParams {
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSalePromotionParams {
    pub company_id: Option<u64>,
    pub code: String,
    pub name: String,
    pub discount_percent: f64,
    pub discount_fixed: f64,
    pub min_amount: f64,
    pub is_active: bool,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSaleOrderOptionParams {
    pub product_id: u64,
    pub name: String,
    pub quantity: f64,
    pub uom_id: u64,
    pub price_unit: f64,
    pub discount: f64,
    pub is_present: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateSaleOrderOptionParams {
    pub name: Option<String>,
    pub quantity: Option<f64>,
    pub price_unit: Option<f64>,
    pub discount: Option<f64>,
    pub is_present: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplySalePromotionParams {
    pub promotion_code: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AccrueSaleCommissionParams {
    pub rate_percent: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SettleSaleCommissionsParams {
    pub commission_ids: Vec<u64>,
    pub journal_id: u64,
    pub expense_account_id: u64,
    pub payable_account_id: u64,
    pub date: Timestamp,
    pub reference: Option<String>,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Remap line tax ids through a fiscal position (Odoo-style tax map).
pub(crate) fn remap_taxes_for_fiscal_position(
    ctx: &ReducerContext,
    organization_id: u64,
    fiscal_position_id: Option<u64>,
    tax_ids: &[u64],
) -> Result<Vec<u64>, String> {
    let Some(fp_id) = fiscal_position_id else {
        return Ok(tax_ids.to_vec());
    };
    let fp = ctx
        .db
        .account_fiscal_position()
        .id()
        .find(&fp_id)
        .ok_or("Fiscal position not found")?;
    if fp.organization_id != organization_id {
        return Err("Fiscal position belongs to a different organization".to_string());
    }
    if !fp.is_active {
        return Ok(tax_ids.to_vec());
    }

    let maps: Vec<_> = ctx
        .db
        .account_fiscal_position_tax()
        .fiscal_tax_by_position()
        .filter(&fp_id)
        .collect();
    if maps.is_empty() {
        return Ok(tax_ids.to_vec());
    }

    let mut out: Vec<u64> = Vec::new();
    for &tid in tax_ids {
        let mut matched = false;
        for m in maps.iter().filter(|m| m.tax_src_id == tid) {
            matched = true;
            if let Some(dest) = m.tax_dest_id {
                if !out.contains(&dest) {
                    out.push(dest);
                }
            }
        }
        if !matched && !out.contains(&tid) {
            out.push(tid);
        }
    }
    Ok(out)
}

pub(crate) fn resolve_incoterm_code(
    ctx: &ReducerContext,
    organization_id: u64,
    incoterm_id: Option<u64>,
) -> Result<Option<String>, String> {
    let Some(id) = incoterm_id else {
        return Ok(None);
    };
    let row = ctx
        .db
        .account_incoterm()
        .id()
        .find(&id)
        .ok_or("Incoterm not found")?;
    if row.organization_id != organization_id {
        return Err("Incoterm belongs to a different organization".to_string());
    }
    if !row.is_active {
        return Err("Incoterm is inactive".to_string());
    }
    Ok(Some(row.code))
}

fn preferred_supplier_for_product(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
) -> Result<(u64, f64), String> {
    let mut best: Option<(i32, u64, f64)> = None;
    for info in ctx
        .db
        .product_supplier_info()
        .supplier_info_by_org()
        .filter(&organization_id)
    {
        if !info.is_active {
            continue;
        }
        let matches = info.product_id == Some(product_id)
            || info.product_tmpl_id == Some(product_id);
        if !matches {
            continue;
        }
        match best {
            Some((seq, _, _)) if info.sequence >= seq => {}
            _ => best = Some((info.sequence, info.partner_id, info.price)),
        }
    }
    best.map(|(_, partner, price)| (partner, price))
        .ok_or_else(|| {
            format!(
                "Dropship requires product_supplier_info for product {}",
                product_id
            )
        })
}

/// On dropship confirm: create one draft PO per vendor and link to the SO.
pub(crate) fn create_dropship_purchase_orders_for_sale(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found for dropship")?;
    if !order.is_dropship {
        return Ok(());
    }

    let lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .filter(|l| l.display_type.is_none() && l.product_uom_qty > 0.0)
        .collect();
    if lines.is_empty() {
        return Ok(());
    }

    // vendor_id -> lines
    let mut by_vendor: Vec<(u64, Vec<(u64, f64, u64, f64)>)> = Vec::new();
    for line in &lines {
        let (vendor_id, supplier_price) =
            preferred_supplier_for_product(ctx, organization_id, line.product_id)?;
        let price = if supplier_price > 0.0 {
            supplier_price
        } else {
            line.purchase_price.max(line.price_unit)
        };
        if let Some((_, bucket)) = by_vendor.iter_mut().find(|(v, _)| *v == vendor_id) {
            bucket.push((line.product_id, line.product_uom_qty, line.product_uom, price));
        } else {
            by_vendor.push((
                vendor_id,
                vec![(line.product_id, line.product_uom_qty, line.product_uom, price)],
            ));
        }
    }

    let order_label = order
        .reference
        .clone()
        .unwrap_or_else(|| order_id.to_string());
    let mut po_ids: Vec<u64> = order.purchase_order_ids.clone();

    for (vendor_id, vendor_lines) in by_vendor {
        create_purchase_order(
            ctx,
            organization_id,
            CreatePurchaseOrderParams {
                company_id: Some(order.company_id),
                partner_id: vendor_id,
                currency_id: order.currency_id,
                origin: Some(format!("dropship:SO/{order_label}")),
                partner_ref: order.client_order_ref.clone(),
                notes: Some(format!("Dropship for sale order {order_label}")),
                date_planned: order.commitment_date.or(order.expected_date),
                payment_term_id: None,
                fiscal_position_id: order.fiscal_position_id,
                incoterm_id: order.incoterm_id,
                incoterm_location: order.incoterm_location.clone(),
                user_id: Some(order.user_id),
                invoice_ids: vec![],
                picking_ids: vec![],
                message_follower_ids: vec![],
                message_ids: vec![],
                activity_ids: vec![],
                is_quantity_copy: None,
                metadata: Some(format!(
                    r#"{{"sale_order_id":{order_id},"dropship":true}}"#
                )),
            },
        )?;

        let po = ctx
            .db
            .purchase_order()
            .iter()
            .filter(|p| {
                p.organization_id == organization_id
                    && p.partner_id == vendor_id
                    && p.origin.as_deref() == Some(&format!("dropship:SO/{order_label}"))
            })
            .max_by_key(|p| p.id)
            .ok_or("Dropship purchase order not found after create")?;

        for (idx, (product_id, qty, uom_id, price)) in vendor_lines.into_iter().enumerate() {
            add_purchase_order_line(
                ctx,
                organization_id,
                po.id,
                AddPurchaseOrderLineParams {
                    product_id,
                    quantity: qty,
                    uom_id,
                    price_unit: price,
                    discount: 0.0,
                    tax_ids: vec![],
                    name: None,
                    sequence: Some(((idx + 1) as u32) * 10),
                    display_type: None,
                    product_variant_id: None,
                    account_analytic_id: None,
                    date_planned: None,
                    propagate_cancel: Some(true),
                    metadata: Some(format!(r#"{{"sale_order_id":{order_id}}}"#)),
                },
            )?;
        }

        if !po_ids.contains(&po.id) {
            po_ids.push(po.id);
        }
    }

    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found after dropship PO create")?;
    ctx.db.sale_order().id().update(SaleOrder {
        purchase_order_ids: po_ids.clone(),
        purchase_order_count: po_ids.len() as u32,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    Ok(())
}

/// Accrue a salesperson commission row for a confirmed SO (idempotent per order).
pub(crate) fn accrue_sale_commission_for_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    rate_percent: f64,
) -> Result<(), String> {
    if rate_percent < 0.0 {
        return Err("Commission rate cannot be negative".to_string());
    }
    if ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order_id)
        .any(|c| c.state != "cancelled")
    {
        return Ok(());
    }
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found for commission")?;
    let amount = order.amount_total * (rate_percent / 100.0);
    let row = ctx.db.sale_commission().insert(SaleCommission {
        id: 0,
        organization_id,
        company_id: order.company_id,
        sale_order_id: order_id,
        salesperson_id: order.user_id,
        basis_amount: order.amount_total,
        rate_percent,
        amount,
        state: "accrued".to_string(),
        settle_move_id: None,
        settled_at: None,
        settle_batch_id: None,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "sale_commission",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "sale_order_id": order_id,
                    "amount": amount,
                    "rate_percent": rate_percent,
                })
                .to_string(),
            ),
            changed_fields: vec!["amount".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Fiscal position ────────────────────────────────────────────────

#[reducer]
pub fn create_fiscal_position(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateFiscalPositionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    if params.name.trim().is_empty() {
        return Err("Fiscal position name is required".to_string());
    }
    let row = ctx.db.account_fiscal_position().insert(AccountFiscalPosition {
        id: 0,
        organization_id,
        company_id: params.company_id,
        name: params.name.clone(),
        is_active: params.is_active,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "account_fiscal_position",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_fiscal_position_tax(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateFiscalPositionTaxParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let fp = ctx
        .db
        .account_fiscal_position()
        .id()
        .find(&params.fiscal_position_id)
        .ok_or("Fiscal position not found")?;
    if fp.organization_id != organization_id {
        return Err("Fiscal position belongs to a different organization".to_string());
    }
    let row = ctx
        .db
        .account_fiscal_position_tax()
        .insert(AccountFiscalPositionTax {
            id: 0,
            organization_id,
            fiscal_position_id: params.fiscal_position_id,
            tax_src_id: params.tax_src_id,
            tax_dest_id: params.tax_dest_id,
            sequence: params.sequence,
            metadata: params.metadata.clone(),
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: fp.company_id,
            table_name: "account_fiscal_position_tax",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "fiscal_position_id": params.fiscal_position_id,
                    "tax_src_id": params.tax_src_id,
                    "tax_dest_id": params.tax_dest_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["tax_src_id".to_string(), "tax_dest_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Incoterm ───────────────────────────────────────────────────────

#[reducer]
pub fn create_incoterm(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateIncotermParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let code = params.code.trim().to_uppercase();
    if code.is_empty() {
        return Err("Incoterm code is required".to_string());
    }
    if params.name.trim().is_empty() {
        return Err("Incoterm name is required".to_string());
    }
    if ctx
        .db
        .account_incoterm()
        .incoterm_by_org()
        .filter(&organization_id)
        .any(|i| i.code.eq_ignore_ascii_case(&code))
    {
        return Err(format!("Incoterm code {code} already exists"));
    }
    let row = ctx.db.account_incoterm().insert(AccountIncoterm {
        id: 0,
        organization_id,
        code: code.clone(),
        name: params.name.clone(),
        is_active: params.is_active,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "account_incoterm",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "code": code, "name": params.name }).to_string()),
            changed_fields: vec!["code".to_string(), "name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Promotions ─────────────────────────────────────────────────────

#[reducer]
pub fn create_sale_promotion(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateSalePromotionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let code = params.code.trim().to_uppercase();
    if code.is_empty() {
        return Err("Promotion code is required".to_string());
    }
    if params.discount_percent < 0.0 || params.discount_fixed < 0.0 {
        return Err("Promotion discounts cannot be negative".to_string());
    }
    let row = ctx.db.sale_promotion().insert(SalePromotion {
        id: 0,
        organization_id,
        company_id: params.company_id,
        code: code.clone(),
        name: params.name.clone(),
        discount_percent: params.discount_percent,
        discount_fixed: params.discount_fixed,
        min_amount: params.min_amount,
        is_active: params.is_active,
        date_start: params.date_start,
        date_end: params.date_end,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "sale_promotion",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "code": code }).to_string()),
            changed_fields: vec!["code".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Apply a promotion code to a draft SO: bump line discounts and recompute totals.
#[reducer]
pub fn apply_sale_promotion_to_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    params: ApplySalePromotionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    if order.state != crate::types::SaleState::Draft
        && order.state != crate::types::SaleState::Sent
    {
        return Err("Promotions can only be applied to Draft or Sent quotations".to_string());
    }

    let code = params.promotion_code.trim().to_uppercase();
    let promo = ctx
        .db
        .sale_promotion()
        .promotion_by_code()
        .filter(&code)
        .find(|p| p.organization_id == organization_id && p.is_active)
        .ok_or("Promotion not found or inactive")?;
    if let Some(start) = promo.date_start {
        if ctx.timestamp < start {
            return Err("Promotion is not yet active".to_string());
        }
    }
    if let Some(end) = promo.date_end {
        if ctx.timestamp > end {
            return Err("Promotion has expired".to_string());
        }
    }
    if order.amount_untaxed + 1e-9 < promo.min_amount {
        return Err(format!(
            "Order untaxed amount below promotion minimum ({})",
            promo.min_amount
        ));
    }

    for line in ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
    {
        if line.display_type.is_some() {
            continue;
        }
        let mut discount = line.discount.max(promo.discount_percent);
        if promo.discount_fixed > 0.0 && line.product_uom_qty > 0.0 && line.price_unit > 0.0 {
            let fixed_as_pct =
                (promo.discount_fixed / (line.price_unit * line.product_uom_qty)) * 100.0;
            discount = discount.max(fixed_as_pct.min(100.0));
        }
        let discount_amount = line.price_unit * line.product_uom_qty * (discount / 100.0);
        let price_subtotal = line.price_unit * line.product_uom_qty - discount_amount;
        let price_tax = crate::helpers::calculate_tax(ctx, &line.tax_id, price_subtotal);
        ctx.db.sale_order_line().id().update(crate::sales::sales_core::SaleOrderLine {
            discount,
            price_subtotal,
            price_tax,
            price_total: price_subtotal + price_tax,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..line
        });
    }

    crate::sales::sales_core::compute_so_totals(ctx, organization_id, order_id)?;

    let mut meta = order
        .metadata
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    meta.insert(
        "promotion_code".to_string(),
        serde_json::Value::String(code.clone()),
    );
    meta.insert(
        "promotion_id".to_string(),
        serde_json::json!(promo.id),
    );
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found after promo")?;
    ctx.db.sale_order().id().update(SaleOrder {
        metadata: Some(serde_json::Value::Object(meta).to_string()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "sale_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "promotion_code": code }).to_string()),
            changed_fields: vec!["metadata".to_string(), "discount".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Sale order options (CPQ-lite) ───────────────────────────────────

#[reducer]
pub fn create_sale_order_option(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    params: CreateSaleOrderOptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    if order.state != crate::types::SaleState::Draft
        && order.state != crate::types::SaleState::Sent
    {
        return Err("Options can only be added on Draft or Sent quotations".to_string());
    }
    let _ = ctx.db.product().id().find(&params.product_id);
    let row = ctx.db.sale_order_option().insert(SaleOrderOption {
        id: 0,
        order_id,
        line_id: None,
        product_id: params.product_id,
        name: params.name.clone(),
        quantity: params.quantity,
        uom_id: params.uom_id,
        price_unit: params.price_unit,
        discount: params.discount,
        is_present: params.is_present,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata.clone(),
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "sale_order_option",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_sale_order_option(
    ctx: &ReducerContext,
    organization_id: u64,
    option_id: u64,
    params: UpdateSaleOrderOptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let option = ctx
        .db
        .sale_order_option()
        .id()
        .find(&option_id)
        .ok_or("Sale order option not found")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&option.order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    ctx.db.sale_order_option().id().update(SaleOrderOption {
        name: params.name.unwrap_or(option.name),
        quantity: params.quantity.unwrap_or(option.quantity),
        price_unit: params.price_unit.unwrap_or(option.price_unit),
        discount: params.discount.unwrap_or(option.discount),
        is_present: params.is_present.unwrap_or(option.is_present),
        metadata: params.metadata.or(option.metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..option
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "sale_order_option",
            record_id: option_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["option".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_sale_order_option(
    ctx: &ReducerContext,
    organization_id: u64,
    option_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let option = ctx
        .db
        .sale_order_option()
        .id()
        .find(&option_id)
        .ok_or("Sale order option not found")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&option.order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    ctx.db.sale_order_option().id().delete(&option_id);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "sale_order_option",
            record_id: option_id,
            action: "DELETE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Materialize selected (`is_present`) options as sale order lines (CPQ-lite).
#[reducer]
pub fn apply_sale_order_options(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    if order.state != crate::types::SaleState::Draft
        && order.state != crate::types::SaleState::Sent
    {
        return Err("Options can only be applied on Draft or Sent quotations".to_string());
    }

    let options: Vec<_> = ctx
        .db
        .sale_order_option()
        .iter()
        .filter(|o| o.order_id == order_id && o.is_present && o.line_id.is_none())
        .collect();

    let mut applied = 0u32;
    for opt in options {
        crate::sales::sales_core::create_sale_order_line(
            ctx,
            organization_id,
            order_id,
            CreateSaleOrderLineParams {
                product_id: opt.product_id,
                quantity: opt.quantity,
                uom_id: opt.uom_id,
                price_unit: Some(opt.price_unit),
                discount: opt.discount,
                tax_ids: vec![],
                name: Some(opt.name.clone()),
                sequence: 100,
                is_downpayment: false,
                display_type: None,
                product_variant_id: None,
                packaging_id: None,
                route_id: None,
                analytic_tag_ids: vec![],
                customer_lead: None,
                metadata: Some(format!(r#"{{"from_option_id":{}}}"#, opt.id)),
            },
        )?;
        let line = ctx
            .db
            .sale_order_line()
            .order_line_by_order()
            .filter(&order_id)
            .filter(|l| l.product_id == opt.product_id)
            .max_by_key(|l| l.id);
        if let Some(line) = line {
            ctx.db.sale_order_option().id().update(SaleOrderOption {
                line_id: Some(line.id),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..opt
            });
            applied += 1;
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "sale_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "options_applied": applied }).to_string(),
            ),
            changed_fields: vec!["order_line".to_string(), "sale_order_option".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Commission ─────────────────────────────────────────────────────

#[reducer]
pub fn accrue_sale_commission(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    params: AccrueSaleCommissionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    if order.state != crate::types::SaleState::Sale
        && order.state != crate::types::SaleState::Done
    {
        return Err("Commission can only accrue on confirmed sale orders".to_string());
    }
    accrue_sale_commission_for_order(ctx, organization_id, order_id, params.rate_percent)
}

/// Accrue from OutInvoice post when SO metadata has `commission_rate_percent` > 0.
pub(crate) fn maybe_accrue_commission_on_invoice_post(
    ctx: &ReducerContext,
    organization_id: u64,
    sale_order_id: u64,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&sale_order_id)
        .ok_or("Sale order not found for commission accrual")?;
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    let rate = order
        .metadata
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| {
            v.get("commission_rate_percent")
                .and_then(|x| x.as_f64())
        })
        .unwrap_or(0.0);
    if rate <= 0.0 {
        return Ok(());
    }
    accrue_sale_commission_for_order(ctx, organization_id, sale_order_id, rate)
}

/// Cancel accrued commissions for an SO. Fails if any commission is already settled.
pub(crate) fn cancel_accrued_commissions_for_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    sale_order_id: u64,
    reason: &str,
) -> Result<(), String> {
    let rows: Vec<_> = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&sale_order_id)
        .filter(|c| c.organization_id == organization_id)
        .collect();

    for row in &rows {
        if row.state == "settled" {
            return Err(format!(
                "Cannot claw back settled commission {} for sale order {} — reverse settlement first ({})",
                row.id, sale_order_id, reason
            ));
        }
    }

    for row in rows {
        if row.state != "accrued" {
            continue;
        }
        let company_id = row.company_id;
        let id = row.id;
        ctx.db.sale_commission().id().update(SaleCommission {
            state: "cancelled".to_string(),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: Some(
                serde_json::json!({ "clawback_reason": reason })
                    .to_string(),
            ),
            ..row
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "sale_commission",
                record_id: id,
                action: "UPDATE",
                old_values: Some(serde_json::json!({ "state": "accrued" }).to_string()),
                new_values: Some(
                    serde_json::json!({ "state": "cancelled", "reason": reason }).to_string(),
                ),
                changed_fields: vec!["state".to_string()],
                metadata: None,
            },
        );
    }
    Ok(())
}

fn insert_commission_settle_line(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    move_name: &str,
    company_id: u64,
    journal_id: u64,
    currency_id: u64,
    date: Timestamp,
    account_id: u64,
    line_name: &str,
    debit: f64,
    credit: f64,
    sequence: u32,
    metadata: Option<String>,
) {
    ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        organization_id,
        move_id,
        move_name: Some(move_name.to_string()),
        date,
        ref_: None,
        parent_state: AccountMoveState::Posted,
        journal_id,
        company_id,
        company_currency_id: currency_id,
        sequence,
        name: line_name.to_string(),
        quantity: 0.0,
        price_unit: 0.0,
        price: 0.0,
        price_subtotal: 0.0,
        price_total: 0.0,
        discount: 0.0,
        balance: debit - credit,
        currency_id,
        amount_currency: 0.0,
        amount_residual: 0.0,
        amount_residual_currency: 0.0,
        debit,
        credit,
        debit_currency: 0.0,
        credit_currency: 0.0,
        tax_base_amount: 0.0,
        account_id,
        account_internal_type: None,
        account_internal_group: None,
        account_root_id: None,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_ids: vec![],
        tax_repartition_line_id: None,
        tax_audit: None,
        partner_id: None,
        commercial_partner_id: None,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        currency_id_field: None,
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
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        cogs_amount: 0.0,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });
}

#[reducer]
pub fn settle_sale_commissions(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SettleSaleCommissionsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    check_permission(ctx, organization_id, "account_move", "create")?;

    if params.commission_ids.is_empty() {
        return Err("At least one commission id is required".to_string());
    }
    if params.expense_account_id == params.payable_account_id {
        return Err("Expense and payable accounts must differ".to_string());
    }

    let mut commissions = Vec::with_capacity(params.commission_ids.len());
    for id in &params.commission_ids {
        let row = ctx
            .db
            .sale_commission()
            .id()
            .find(id)
            .ok_or_else(|| format!("Commission {id} not found"))?;
        if row.organization_id != organization_id {
            return Err(format!("Commission {id} does not belong to this organization"));
        }
        if row.company_id != company_id {
            return Err(format!("Commission {id} does not belong to this company"));
        }
        if row.state != "accrued" {
            return Err(format!(
                "Commission {id} is not accrued (state={})",
                row.state
            ));
        }
        commissions.push(row);
    }

    let total: f64 = commissions.iter().map(|c| c.amount).sum();
    if total <= 0.0 {
        return Err("Settlement total must be positive".to_string());
    }

    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    let currency_id = company_row.currency_id;
    let name = next_doc_number(ctx, "COMM");

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: params.reference.clone(),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: params.date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some("sale_commission_settle".to_string()),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: params.reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: None,
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: params.journal_id,
        currency_id,
        company_currency_id: currency_id,
        amount_untaxed: total,
        amount_tax: 0.0,
        amount_total: total,
        amount_residual: 0.0,
        amount_untaxed_signed: total,
        amount_tax_signed: 0.0,
        amount_total_signed: total,
        amount_total_in_currency_signed: total,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: true,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::Paid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "commission_ids": params.commission_ids,
                "settle_kind": "commission",
            })
            .to_string(),
        ),
    });

    insert_commission_settle_line(
        ctx,
        organization_id,
        move_record.id,
        &name,
        company_id,
        params.journal_id,
        currency_id,
        params.date,
        params.expense_account_id,
        "Commission expense",
        total,
        0.0,
        1,
        params.metadata.clone(),
    );
    insert_commission_settle_line(
        ctx,
        organization_id,
        move_record.id,
        &name,
        company_id,
        params.journal_id,
        currency_id,
        params.date,
        params.payable_account_id,
        "Commission payable",
        0.0,
        total,
        2,
        params.metadata.clone(),
    );

    for row in commissions {
        let id = row.id;
        ctx.db.sale_commission().id().update(SaleCommission {
            state: "settled".to_string(),
            settle_move_id: Some(move_record.id),
            settled_at: Some(ctx.timestamp),
            settle_batch_id: Some(move_record.id),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..row
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "sale_commission",
                record_id: id,
                action: "UPDATE",
                old_values: Some(serde_json::json!({ "state": "accrued" }).to_string()),
                new_values: Some(
                    serde_json::json!({
                        "state": "settled",
                        "settle_move_id": move_record.id,
                    })
                    .to_string(),
                ),
                changed_fields: vec![
                    "state".to_string(),
                    "settle_move_id".to_string(),
                    "settled_at".to_string(),
                ],
                metadata: None,
            },
        );
    }

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
                    "name": name,
                    "amount_total": total,
                    "settle_kind": "commission",
                })
                .to_string(),
            ),
            changed_fields: vec!["amount_total".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn cancel_sale_commission(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    commission_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let row = ctx
        .db
        .sale_commission()
        .id()
        .find(&commission_id)
        .ok_or("Commission not found")?;
    if row.organization_id != organization_id {
        return Err("Commission does not belong to this organization".to_string());
    }
    if row.company_id != company_id {
        return Err("Commission does not belong to this company".to_string());
    }
    if row.state != "accrued" {
        return Err(format!(
            "Only accrued commissions can be cancelled (state={})",
            row.state
        ));
    }
    ctx.db.sale_commission().id().update(SaleCommission {
        state: "cancelled".to_string(),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..row
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_commission",
            record_id: commission_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "accrued" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "cancelled" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn reverse_sale_commission_settlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    commission_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    check_permission(ctx, organization_id, "account_move", "create")?;

    let row = ctx
        .db
        .sale_commission()
        .id()
        .find(&commission_id)
        .ok_or("Commission not found")?;
    if row.organization_id != organization_id {
        return Err("Commission does not belong to this organization".to_string());
    }
    if row.company_id != company_id {
        return Err("Commission does not belong to this company".to_string());
    }
    if row.state != "settled" {
        return Err(format!(
            "Only settled commissions can be reversed (state={})",
            row.state
        ));
    }
    let settle_move_id = row
        .settle_move_id
        .ok_or("Settled commission is missing settle_move_id")?;
    let settle_move = ctx
        .db
        .account_move()
        .id()
        .find(&settle_move_id)
        .ok_or("Settlement move not found")?;
    if settle_move.company_id != company_id {
        return Err("Settlement move does not belong to this company".to_string());
    }

    let amount = row.amount;
    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    let currency_id = company_row.currency_id;
    let name = next_doc_number(ctx, "COMMR");

    // Find expense (debit) and payable (credit) accounts from original settle move.
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&settle_move_id)
        .collect();
    let expense_line = lines
        .iter()
        .find(|l| l.debit > 0.0)
        .ok_or("Settlement move missing expense (debit) line")?;
    let payable_line = lines
        .iter()
        .find(|l| l.credit > 0.0)
        .ok_or("Settlement move missing payable (credit) line")?;

    let reverse = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: Some(format!("REV {}", settle_move.name)),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: ctx.timestamp,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("reverse_commission:{}", commission_id)),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: None,
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: settle_move.journal_id,
        currency_id,
        company_currency_id: currency_id,
        amount_untaxed: amount,
        amount_tax: 0.0,
        amount_total: amount,
        amount_residual: 0.0,
        amount_untaxed_signed: amount,
        amount_tax_signed: 0.0,
        amount_total_signed: amount,
        amount_total_in_currency_signed: amount,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: true,
        is_storno: true,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::Paid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "reverses_move_id": settle_move_id,
                "commission_id": commission_id,
            })
            .to_string(),
        ),
    });

    // Reverse: Dr payable / Cr expense
    insert_commission_settle_line(
        ctx,
        organization_id,
        reverse.id,
        &name,
        company_id,
        settle_move.journal_id,
        currency_id,
        ctx.timestamp,
        payable_line.account_id,
        "Reverse commission payable",
        amount,
        0.0,
        1,
        None,
    );
    insert_commission_settle_line(
        ctx,
        organization_id,
        reverse.id,
        &name,
        company_id,
        settle_move.journal_id,
        currency_id,
        ctx.timestamp,
        expense_line.account_id,
        "Reverse commission expense",
        0.0,
        amount,
        2,
        None,
    );

    ctx.db.sale_commission().id().update(SaleCommission {
        state: "cancelled".to_string(),
        settle_move_id: Some(reverse.id),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "reversed_settle_move_id": settle_move_id,
                "reverse_move_id": reverse.id,
            })
            .to_string(),
        ),
        ..row
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_commission",
            record_id: commission_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "settled" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "cancelled",
                    "reverse_move_id": reverse.id,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string(), "settle_move_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ── Reducers: Exchange ───────────────────────────────────────────────────────

/// Create a draft replacement SO from a confirmed/received RMA (exchange).
#[reducer]
pub fn create_exchange_order_from_return(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    return_order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "create")?;
    let rma = ctx
        .db
        .return_order()
        .id()
        .find(&return_order_id)
        .ok_or("Return order not found")?;
    if rma.organization_id != organization_id || rma.company_id != company_id {
        return Err("Return order does not belong to this company".to_string());
    }
    if rma.state != "confirmed" && rma.state != "received" {
        return Err("Exchange requires a confirmed or received return".to_string());
    }

    let so = if let Some(so_id) = rma.sale_order_id {
        ctx.db
            .sale_order()
            .id()
            .find(&so_id)
            .ok_or("Original sale order not found")?
    } else {
        return Err("Return order has no linked sale order".to_string());
    };

    let lines: Vec<_> = ctx
        .db
        .return_order_line()
        .iter()
        .filter(|l| l.return_order_id == return_order_id)
        .collect();
    if lines.is_empty() {
        return Err("Return order has no lines".to_string());
    }

    let order_lines: Vec<CreateSaleOrderLineParams> = lines
        .iter()
        .map(|l| CreateSaleOrderLineParams {
            product_id: l.product_id,
            quantity: l.product_uom_qty,
            uom_id: l.product_uom,
            price_unit: Some(l.price_unit),
            discount: 0.0,
            tax_ids: vec![],
            name: Some(format!("Exchange: product {}", l.product_id)),
            sequence: 10,
            is_downpayment: false,
            display_type: None,
            product_variant_id: None,
            packaging_id: None,
            route_id: None,
            analytic_tag_ids: vec![],
            customer_lead: None,
            metadata: Some(format!(
                r#"{{"exchange_return_id":{return_order_id},"sale_order_line_id":{:?}}}"#,
                l.sale_order_line_id
            )),
        })
        .collect();

    create_sale_order(
        ctx,
        organization_id,
        CreateSaleOrderParams {
            company_id: Some(company_id),
            partner_id: so.partner_id,
            partner_invoice_id: so.partner_invoice_id,
            partner_shipping_id: so.partner_shipping_id,
            pricelist_id: so.pricelist_id,
            currency_id: so.currency_id,
            warehouse_id: so.warehouse_id,
            order_lines,
            origin: Some(format!("exchange:RMA/{return_order_id}")),
            client_order_ref: so.client_order_ref.clone(),
            payment_term_id: so.payment_term_id,
            fiscal_position_id: so.fiscal_position_id,
            team_id: so.team_id,
            opportunity_id: None,
            proposal_id: None,
            note: Some(format!("Exchange for return {return_order_id}")),
            terms_and_conditions: None,
            validity_days: Some(30),
            shipping_policy: Some(so.shipping_policy.clone()),
            picking_policy: Some(so.picking_policy.clone()),
            campaign_id: None,
            medium_id: None,
            source_id: None,
            commitment_date: None,
            expected_date: None,
            incoterm_id: so.incoterm_id,
            incoterm: so.incoterm.clone(),
            incoterm_location: so.incoterm_location.clone(),
            carrier_id: so.carrier_id,
            customer_lead: None,
            analytic_account_id: so.analytic_account_id,
            user_id: Some(so.user_id),
            is_printed: Some(false),
            is_locked: Some(false),
            is_dropship: Some(false),
            invoice_policy: None,
            message_follower_ids: None,
            message_partner_ids: None,
            message_channel_ids: None,
            activity_ids: None,
            metadata: Some(format!(
                r#"{{"exchange_return_id":{return_order_id},"origin_so_id":{}}}"#,
                so.id
            )),
        },
    )?;

    // Link origin_so_id on the new draft SO
    if let Some(ex) = ctx
        .db
        .sale_order()
        .iter()
        .filter(|o| {
            o.organization_id == organization_id
                && o.origin.as_deref() == Some(&format!("exchange:RMA/{return_order_id}"))
        })
        .max_by_key(|o| o.id)
    {
        ctx.db.sale_order().id().update(SaleOrder {
            origin_so_id: Some(so.id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..ex
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_order",
            record_id: return_order_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "exchange_return_id": return_order_id,
                    "origin_so_id": so.id,
                })
                .to_string(),
            ),
            changed_fields: vec!["origin_so_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
