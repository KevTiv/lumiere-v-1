//! Durable invocation identity for partial stock and service receipts.
use crate::helpers::check_permission;
use crate::inventory::product::product;
use crate::inventory::stock::{product_requires_stock, stock_move, stock_picking};
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line, receive_po_line};
use crate::types::PoState;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

#[spacetimedb::table(
    accessor = purchase_receipt_operation,
    index(accessor = purchase_receipt_operation_by_scope, btree(columns = [organization_id, company_id])),
    index(accessor = purchase_receipt_operation_by_line, btree(columns = [line_id]))
)]
pub struct PurchaseReceiptOperation {
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub operation_key: String,
    pub line_id: u64,
    pub order_id: u64,
    pub quantity: f64,
    pub lot_id: Option<u64>,
    pub received_before: f64,
    pub received_after: f64,
    pub move_id: Option<u64>,
    pub picking_id: Option<u64>,
    pub continuation_move_id: Option<u64>,
    pub continuation_picking_id: Option<u64>,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[derive(SpacetimeType, Clone)]
pub struct ReceivePoLineOnceParams {
    pub operation_key: String,
    pub quantity: f64,
    pub lot_id: Option<u64>,
    pub expected_received: f64,
    pub expected_move_id: Option<u64>,
    pub expected_picking_id: Option<u64>,
}

pub(crate) fn scoped_key(
    organization_id: u64,
    company_id: u64,
    key: &str,
) -> Result<String, String> {
    if key.is_empty()
        || key.len() > 128
        || !key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err(
            "Receipt operation key must be 1–128 ASCII letters, digits, hyphens or underscores"
                .into(),
        );
    }
    Ok(format!("{organization_id}:{company_id}:{key}"))
}

/// Same scope/key/input resolves the immutable event, even after later receipts.
/// New physical receipts require a distinct key and freshly reviewed evidence.
#[spacetimedb::reducer]
pub fn receive_po_line_once(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: ReceivePoLineOnceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "write")?;
    crate::workflow::authorization::require_workflow_company_access(
        ctx,
        organization_id,
        company_id,
        ctx.sender(),
    )?;
    let id = scoped_key(organization_id, company_id, &params.operation_key)?;
    if !params.quantity.is_finite()
        || params.quantity <= 0.0
        || !params.expected_received.is_finite()
        || params.expected_received < 0.0
    {
        return Err("Receipt quantities must be finite, with positive quantity and non-negative reviewed received quantity".into());
    }
    let line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("Receipt source unavailable")?;
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&line.order_id)
        .ok_or("Receipt source unavailable")?;
    if line.organization_id != organization_id
        || order.organization_id != organization_id
        || line.company_id != company_id
        || order.company_id != company_id
    {
        return Err("Receipt source is outside current scope".into());
    }
    if let Some(previous) = ctx.db.purchase_receipt_operation().id().find(&id) {
        if previous.organization_id != organization_id
            || previous.company_id != company_id
            || previous.created_by != ctx.sender()
            || previous.line_id != line_id
            || previous.order_id != order.id
            || previous.quantity.to_bits() != params.quantity.to_bits()
            || previous.lot_id != params.lot_id
            || previous.received_before.to_bits() != params.expected_received.to_bits()
            || previous.move_id != params.expected_move_id
            || previous.picking_id != params.expected_picking_id
        {
            return Err(
                "Receipt key was already used by another actor or with different input".into(),
            );
        }
        // Authorization and live source scope were checked before returning.
        return Ok(());
    }
    if order.state != PoState::Purchase
        || !line.qty_received.is_finite()
        || !line.product_qty.is_finite()
        || line.qty_received != params.expected_received
    {
        return Err("Receipt source changed; refresh and review before receiving".into());
    }
    let product = ctx
        .db
        .product()
        .id()
        .find(&line.product_id)
        .ok_or("Receipt product unavailable")?;
    if product.organization_id != organization_id {
        return Err("Receipt product is outside current scope".into());
    }
    let stock = product_requires_stock(ctx, line.product_id);
    let open: Vec<_> = ctx
        .db
        .stock_move()
        .iter()
        .filter(|m| {
            m.organization_id == organization_id
                && m.company_id == company_id
                && m.purchase_line_id == Some(line_id)
                && !m.is_done
                && m.state != "cancel"
                && m.state != "done"
        })
        .collect();
    if stock {
        if open.len() != 1
            || open[0].product_id != line.product_id
            || Some(open[0].id) != params.expected_move_id
            || open[0].picking_id != params.expected_picking_id
            || params.expected_picking_id.is_none()
        {
            return Err("Receipt requires the exact current open move and picking".into());
        }
        if let Some(lot_id) = params.lot_id {
            crate::inventory::stock::ensure_lot_for_product(
                ctx,
                organization_id,
                company_id,
                line.product_id,
                lot_id,
            )?;
        }
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(&params.expected_picking_id.ok_or("Picking required")?)
            .ok_or("Receipt picking unavailable")?;
        if picking.organization_id != organization_id
            || picking.company_id != company_id
            || picking.purchase_id != Some(order.id)
        {
            return Err("Receipt picking is outside source scope".into());
        }
    } else if !open.is_empty()
        || params.expected_move_id.is_some()
        || params.expected_picking_id.is_some()
        || params.lot_id.is_some()
    {
        return Err("Service receipt cannot carry stock or lot identities".into());
    }
    receive_po_line(
        ctx,
        organization_id,
        line_id,
        params.quantity,
        params.lot_id,
    )?;
    let after = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("Receipt source missing after effect")?;
    if !after.qty_received.is_finite()
        || (after.qty_received - line.qty_received - params.quantity).abs() > 1e-8
    {
        return Err("Receipt quantity effect did not agree with the invocation".into());
    }
    if let Some(move_id) = params.expected_move_id {
        let completed = ctx
            .db
            .stock_move()
            .id()
            .find(&move_id)
            .ok_or("Receipt move missing after effect")?;
        if !completed.is_done
            || completed.state != "done"
            || completed.picking_id != params.expected_picking_id
        {
            return Err("Receipt move effect could not be proved".into());
        }
    }
    let continuation: Vec<_> = ctx
        .db
        .stock_move()
        .iter()
        .filter(|m| {
            m.organization_id == organization_id
                && m.company_id == company_id
                && m.purchase_line_id == Some(line_id)
                && !m.is_done
                && m.state != "cancel"
                && m.state != "done"
        })
        .collect();
    if continuation.len() > 1 {
        return Err("Receipt continuation is ambiguous".into());
    }
    let continuation_move_id = continuation.first().map(|m| m.id);
    let continuation_picking_id = continuation.first().and_then(|m| m.picking_id);
    ctx.db
        .purchase_receipt_operation()
        .insert(PurchaseReceiptOperation {
            id,
            organization_id,
            company_id,
            operation_key: params.operation_key,
            line_id,
            order_id: order.id,
            quantity: params.quantity,
            lot_id: params.lot_id,
            received_before: line.qty_received,
            received_after: after.qty_received,
            move_id: params.expected_move_id,
            picking_id: params.expected_picking_id,
            continuation_move_id,
            continuation_picking_id,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    Ok(())
}
