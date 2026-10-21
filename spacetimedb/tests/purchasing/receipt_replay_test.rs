//! Authored reducer regressions for durable partial receipt replay.
use super::gap_fixes_test::seed_vendor_po;
use crate::inventory::stock::stock_move;
use crate::purchasing::purchase_orders::{confirm_purchase_order, purchase_order_line};
use crate::purchasing::receipt_operations::{
    purchase_receipt_operation, receive_po_line_once, ReceivePoLineOnceParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{ReducerContext, Table};

pub fn test_durable_partial_receipt(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, po) = seed_vendor_po(ctx, &f, "RECEIPT-REPLAY")?;
    confirm_purchase_order(ctx, org, po)?;
    let line = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po)
        .next()
        .ok_or("line")?;
    let target = ctx
        .db
        .stock_move()
        .iter()
        .find(|m| m.purchase_line_id == Some(line.id) && !m.is_done)
        .ok_or("target")?;
    let first = ReceivePoLineOnceParams {
        operation_key: "receipt_first".into(),
        quantity: 1.0,
        lot_id: None,
        expected_received: 0.0,
        expected_move_id: Some(target.id),
        expected_picking_id: target.picking_id,
    };
    let receive = |params| receive_po_line_once(ctx, org, f.company_id, line.id, params);
    receive(first.clone())?;
    receive(first.clone())?;
    let after = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line.id)
        .ok_or("line")?;
    if after.qty_received != 1.0 {
        return Err("same-key replay received twice".into());
    }
    if receive(ReceivePoLineOnceParams {
        quantity: 2.0,
        ..first.clone()
    })
    .is_ok()
    {
        return Err("conflicting key reuse accepted".into());
    }
    if receive(ReceivePoLineOnceParams {
        operation_key: "stale_new_key".into(),
        ..first.clone()
    })
    .is_ok()
    {
        return Err("stale new invocation consumed the backorder".into());
    }
    let receipt = ctx
        .db
        .purchase_receipt_operation()
        .id()
        .find(&format!("{org}:{}:receipt_first", f.company_id))
        .ok_or("receipt")?;
    let next_id = receipt
        .continuation_move_id
        .ok_or("exact continuation missing")?;
    let next = ctx
        .db
        .stock_move()
        .id()
        .find(&next_id)
        .ok_or("continuation")?;
    let second = ReceivePoLineOnceParams {
        operation_key: "receipt_second".into(),
        quantity: 1.0,
        lot_id: None,
        expected_received: 1.0,
        expected_move_id: Some(next.id),
        expected_picking_id: next.picking_id,
    };
    receive(second.clone())?;
    receive(first)?;
    receive(second)?;
    if ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line.id)
        .ok_or("line")?
        .qty_received
        != 2.0
        || ctx
            .db
            .purchase_receipt_operation()
            .purchase_receipt_operation_by_line()
            .filter(&line.id)
            .count()
            != 2
    {
        return Err("distinct receipt cycles or historical replay lost conservation".into());
    }
    Ok(())
}
