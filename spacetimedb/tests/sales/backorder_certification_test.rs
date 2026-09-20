//! INT-04: partial fulfillment / backorder certification.
//!
//! Proves the obligation for what was not shipped is preserved, and that the adversarial paths
//! around it (short stock, duplicate validation, cancelling the remainder, cross-tenant ids)
//! fail closed without leaving reservations or quantities behind.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, CompanyScopeParams};
use crate::inventory::product::product;
use crate::inventory::stock::{
    assign_stock_picking, cancel_stock_picking, confirm_stock_picking, done_stock_move,
    increase_quant_at_location, stock_move, stock_picking, stock_quant, validate_stock_picking,
    validate_stock_picking_backorder, DoneStockMoveParams, StockQuant,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{confirm_sales_order, create_sale_order, sale_order, sale_order_line};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, SaleState};

use super::sales_core_test::minimal_so_params;

const EPS: f64 = 1e-6;

fn scope(fixture: &OrgFixture) -> CompanyScopeParams {
    CompanyScopeParams {
        company_id: Some(fixture.company_id),
    }
}

fn expect_close(what: &str, got: f64, want: f64) -> Result<(), String> {
    if (got - want).abs() > EPS {
        return Err(format!("{what}: expected {want}, got {got}"));
    }
    Ok(())
}

/// The fixture's own currency. Currencies are organization-scoped, so a hard-coded id only
/// resolves for the first organization created in a database.
fn company_currency_id(ctx: &ReducerContext, company_id: u64) -> Result<u64, String> {
    ctx.db
        .company()
        .id()
        .find(&company_id)
        .map(|c| c.currency_id)
        .ok_or_else(|| format!("Company {company_id} not found"))
}

/// A confirmed sale order for `qty` units of the fixture product; returns its id.
fn confirmed_order(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    qty: f64,
    tag: &str,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;
    let currency_id = company_currency_id(ctx, fixture.company_id)?;
    let pricelist_name = format!("BO Cert PL {tag}");
    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            company_id: None,
            name: pricelist_name.clone(),
            currency_id,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == pricelist_name)
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;
    let client_ref = format!("BO-CERT-{tag}");
    let mut params = minimal_so_params(
        fixture,
        product.uom_id,
        qty,
        Some(product.list_price),
        pricelist_id,
        &client_ref,
        tag,
    );
    params.currency_id = currency_id;
    create_sale_order(ctx, org_id, params)?;
    let order_id = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.client_order_ref.as_deref() == Some(&client_ref))
        .map(|o| o.id)
        .ok_or("Sale order not found")?;
    confirm_sales_order(ctx, org_id, fixture.company_id, order_id)?;
    Ok(order_id)
}

/// The original (non-backorder, non-return) delivery picking of an order.
fn first_delivery(ctx: &ReducerContext, org_id: u64, order_id: u64) -> Result<u64, String> {
    ctx.db
        .stock_picking()
        .iter()
        .find(|p| {
            p.organization_id == org_id
                && p.sale_id == Some(order_id)
                && !p.is_return
                && p.backorder_id.is_none()
        })
        .map(|p| p.id)
        .ok_or_else(|| "Delivery picking not found".to_string())
}

fn backorder_of(ctx: &ReducerContext, org_id: u64, picking_id: u64) -> Result<u64, String> {
    let mut found: Vec<u64> = ctx
        .db
        .stock_picking()
        .iter()
        .filter(|p| p.organization_id == org_id && p.backorder_id == Some(picking_id))
        .map(|p| p.id)
        .collect();
    match found.len() {
        1 => Ok(found.remove(0)),
        n => Err(format!(
            "Expected exactly one backorder of picking {picking_id}, found {n}"
        )),
    }
}

fn backorder_count(ctx: &ReducerContext, org_id: u64, picking_id: u64) -> usize {
    ctx.db
        .stock_picking()
        .iter()
        .filter(|p| p.organization_id == org_id && p.backorder_id == Some(picking_id))
        .count()
}

fn picking_state(ctx: &ReducerContext, picking_id: u64) -> Result<String, String> {
    ctx.db
        .stock_picking()
        .id()
        .find(&picking_id)
        .map(|p| p.state)
        .ok_or_else(|| format!("Picking {picking_id} not found"))
}

/// `(move id, location id, demand)` of the single move on a picking.
fn only_move(
    ctx: &ReducerContext,
    org_id: u64,
    picking_id: u64,
) -> Result<(u64, u64, f64), String> {
    ctx.db
        .stock_move()
        .move_by_org()
        .filter(&org_id)
        .find(|m| m.picking_id == Some(picking_id))
        .map(|m| (m.id, m.location_id, m.product_uom_qty))
        .ok_or_else(|| format!("No move on picking {picking_id}"))
}

fn reserved(ctx: &ReducerContext, fixture: &OrgFixture) -> f64 {
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| {
            q.organization_id == fixture.organization_id && q.company_id == fixture.company_id
        })
        .map(|q| q.reserved_quantity)
        .sum()
}

fn on_hand(ctx: &ReducerContext, fixture: &OrgFixture) -> f64 {
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| {
            q.organization_id == fixture.organization_id && q.company_id == fixture.company_id
        })
        .map(|q| q.quantity)
        .sum()
}

fn delivered(ctx: &ReducerContext, order_id: u64) -> f64 {
    ctx.db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .map(|l| l.qty_delivered)
        .sum()
}

/// Simulate stock disappearing between a preview and a commit (damage, a competing pick, a count).
fn set_on_hand(ctx: &ReducerContext, fixture: &OrgFixture, qty: f64) -> Result<(), String> {
    let quant = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .find(|q| {
            q.organization_id == fixture.organization_id && q.company_id == fixture.company_id
        })
        .ok_or("Stock quant not found")?;
    let available_quantity = (qty - quant.reserved_quantity).max(0.0);
    ctx.db.stock_quant().id().update(StockQuant {
        quantity: qty,
        available_quantity,
        ..quant
    });
    Ok(())
}

fn record_done(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    move_id: u64,
    quantity_done: f64,
) -> Result<(), String> {
    done_stock_move(
        ctx,
        fixture.organization_id,
        move_id,
        DoneStockMoveParams {
            company_id: Some(fixture.company_id),
            quantity_done,
        },
    )
}

/// The order's first delivery, confirmed and assigned (stock reserved).
fn ready_delivery(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    order_id: u64,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let picking_id = first_delivery(ctx, org_id, order_id)?;
    confirm_stock_picking(ctx, org_id, picking_id, scope(fixture))?;
    assign_stock_picking(ctx, org_id, picking_id, scope(fixture))?;
    Ok(picking_id)
}

/// Stock short at assignment is refused whole: no partial reservation is taken, the picking stays
/// confirmed, and once stock is back the same picking assigns normally.
pub fn test_short_stock_assign_is_atomic(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = confirmed_order(ctx, &fixture, 10.0, "short-assign")?;
    let picking_id = first_delivery(ctx, org_id, order_id)?;
    confirm_stock_picking(ctx, org_id, picking_id, scope(&fixture))?;

    set_on_hand(ctx, &fixture, 6.0)?;
    let reserved_before = reserved(ctx, &fixture);
    let err = match assign_stock_picking(ctx, org_id, picking_id, scope(&fixture)) {
        Ok(()) => return Err("Assigning 10 against 6 on hand must be rejected".to_string()),
        Err(e) => e,
    };
    if !err.contains("Insufficient") {
        return Err(format!("Expected an insufficient-stock error, got: {err}"));
    }
    if picking_state(ctx, picking_id)? != "confirmed" {
        return Err("A rejected assign must leave the picking confirmed".to_string());
    }
    expect_close(
        "reservation after rejected assign",
        reserved(ctx, &fixture),
        reserved_before,
    )?;

    // Stock returns: the same picking assigns and reserves the full demand once.
    set_on_hand(ctx, &fixture, 100.0)?;
    assign_stock_picking(ctx, org_id, picking_id, scope(&fixture))?;
    expect_close(
        "reservation after retry",
        reserved(ctx, &fixture),
        reserved_before + 10.0,
    )?;
    if picking_state(ctx, picking_id)? != "assigned" {
        return Err("Retry after restock must assign the picking".to_string());
    }
    Ok(())
}

/// Ordered 10, only 6 left by the time of delivery: a full validation is refused untouched, the 6
/// available ship, and the 4 not shipped stay owed on a backorder until stock arrives.
pub fn test_partial_stock_ships_available_and_keeps_remainder(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = confirmed_order(ctx, &fixture, 10.0, "partial-stock")?;
    let picking_id = ready_delivery(ctx, &fixture, order_id)?;
    let (move_id, location_id, demand) = only_move(ctx, org_id, picking_id)?;
    expect_close("demand", demand, 10.0)?;

    // Preview showed 10 reserved; before commit only 6 remain.
    set_on_hand(ctx, &fixture, 6.0)?;

    match validate_stock_picking(ctx, org_id, picking_id, scope(&fixture)) {
        Ok(()) => return Err("Delivering 10 with 6 on hand must be rejected".to_string()),
        Err(e) if e.contains("Cannot deliver more than on-hand") => {}
        Err(e) => return Err(format!("Unexpected validate error: {e}")),
    }
    if picking_state(ctx, picking_id)? != "assigned" {
        return Err("A rejected validation must leave the picking assigned".to_string());
    }
    expect_close(
        "delivered after rejected validation",
        delivered(ctx, order_id),
        0.0,
    )?;
    expect_close(
        "on hand after rejected validation",
        on_hand(ctx, &fixture),
        6.0,
    )?;
    if backorder_count(ctx, org_id, picking_id) != 0 {
        return Err("A rejected validation must not create a backorder".to_string());
    }

    // Ship what is available; keep the rest owed.
    record_done(ctx, &fixture, move_id, 6.0)?;
    validate_stock_picking_backorder(ctx, org_id, picking_id, scope(&fixture))?;
    expect_close("delivered", delivered(ctx, order_id), 6.0)?;
    if picking_state(ctx, picking_id)? != "done" {
        return Err("The shipped picking must be done".to_string());
    }
    let backorder_id = backorder_of(ctx, org_id, picking_id)?;
    let (_, _, owed) = only_move(ctx, org_id, backorder_id)?;
    expect_close("quantity still owed", owed, 4.0)?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order missing")?;
    if order.state != SaleState::Sale {
        return Err(format!(
            "A partly delivered order stays open, got {:?}",
            order.state
        ));
    }
    if !order.picking_ids.contains(&backorder_id) {
        return Err("The backorder must be linked on the order".to_string());
    }

    // With no stock the obligation cannot be assigned, and it holds no reservation while waiting.
    confirm_stock_picking(ctx, org_id, backorder_id, scope(&fixture))?;
    if assign_stock_picking(ctx, org_id, backorder_id, scope(&fixture)).is_ok() {
        return Err("The backorder must not assign with no stock".to_string());
    }
    if picking_state(ctx, backorder_id)? == "assigned" {
        return Err("A refused assign must not leave the backorder assigned".to_string());
    }
    expect_close(
        "reservation while stock is out",
        reserved(ctx, &fixture),
        0.0,
    )?;

    // Stock arrives: the remainder is delivered and the order is fully delivered.
    increase_quant_at_location(
        ctx,
        org_id,
        fixture.company_id,
        fixture.product_id,
        location_id,
        4.0,
        10.0,
    )?;
    assign_stock_picking(ctx, org_id, backorder_id, scope(&fixture))?;
    expect_close(
        "reservation for the remainder",
        reserved(ctx, &fixture),
        4.0,
    )?;
    validate_stock_picking(ctx, org_id, backorder_id, scope(&fixture))?;
    expect_close("delivered in total", delivered(ctx, order_id), 10.0)?;
    expect_close("reservation at the end", reserved(ctx, &fixture), 0.0)?;
    Ok(())
}

/// Validating a picking twice must not deliver twice or create a second backorder.
pub fn test_duplicate_validation_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = confirmed_order(ctx, &fixture, 10.0, "dup-validate")?;
    let picking_id = ready_delivery(ctx, &fixture, order_id)?;
    let (move_id, _, _) = only_move(ctx, org_id, picking_id)?;
    record_done(ctx, &fixture, move_id, 4.0)?;
    validate_stock_picking_backorder(ctx, org_id, picking_id, scope(&fixture))?;

    let on_hand_after_first = on_hand(ctx, &fixture);
    for with_backorder in [true, false] {
        let result = if with_backorder {
            validate_stock_picking_backorder(ctx, org_id, picking_id, scope(&fixture))
        } else {
            validate_stock_picking(ctx, org_id, picking_id, scope(&fixture))
        };
        match result {
            Ok(()) => {
                return Err(format!(
                    "A duplicate validation (backorder: {with_backorder}) must be rejected"
                ))
            }
            Err(e) if e.contains("must be assigned") => {}
            Err(e) => {
                return Err(format!(
                    "Unexpected duplicate-validation error (backorder: {with_backorder}): {e}"
                ))
            }
        }
    }
    if backorder_count(ctx, org_id, picking_id) != 1 {
        return Err("Exactly one backorder must exist after duplicate validations".to_string());
    }
    expect_close("delivered", delivered(ctx, order_id), 4.0)?;
    expect_close("on hand", on_hand(ctx, &fixture), on_hand_after_first)?;
    Ok(())
}

/// Several deliveries: 10 → ship 4 (backorder 6) → ship 3 (backorder 3) → ship 3. Each backorder
/// chains to the picking it came from, and the order ends fully delivered with nothing reserved.
pub fn test_multi_delivery_backorder_chain(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = confirmed_order(ctx, &fixture, 10.0, "chain")?;

    let first = ready_delivery(ctx, &fixture, order_id)?;
    let (m1, _, _) = only_move(ctx, org_id, first)?;
    record_done(ctx, &fixture, m1, 4.0)?;
    validate_stock_picking_backorder(ctx, org_id, first, scope(&fixture))?;
    let second = backorder_of(ctx, org_id, first)?;
    expect_close("first owed", only_move(ctx, org_id, second)?.2, 6.0)?;

    confirm_stock_picking(ctx, org_id, second, scope(&fixture))?;
    assign_stock_picking(ctx, org_id, second, scope(&fixture))?;
    let (m2, _, _) = only_move(ctx, org_id, second)?;
    record_done(ctx, &fixture, m2, 3.0)?;
    validate_stock_picking_backorder(ctx, org_id, second, scope(&fixture))?;
    let third = backorder_of(ctx, org_id, second)?;
    expect_close("second owed", only_move(ctx, org_id, third)?.2, 3.0)?;
    expect_close(
        "delivered after two shipments",
        delivered(ctx, order_id),
        7.0,
    )?;

    confirm_stock_picking(ctx, org_id, third, scope(&fixture))?;
    assign_stock_picking(ctx, org_id, third, scope(&fixture))?;
    validate_stock_picking(ctx, org_id, third, scope(&fixture))?;

    expect_close("delivered in total", delivered(ctx, order_id), 10.0)?;
    expect_close("on hand", on_hand(ctx, &fixture), 90.0)?;
    expect_close("reservation", reserved(ctx, &fixture), 0.0)?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order missing")?;
    if order.delivery_count != 3 || order.picking_ids.len() != 3 {
        return Err(format!(
            "Expected 3 linked deliveries, got count {} / {:?}",
            order.delivery_count, order.picking_ids
        ));
    }
    Ok(())
}

/// Cancelling the remainder releases what its assignment reserved, keeps what already shipped, and
/// leaves the order open at the delivered quantity.
pub fn test_cancel_backorder_releases_reservation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = confirmed_order(ctx, &fixture, 10.0, "cancel-remainder")?;
    let first = ready_delivery(ctx, &fixture, order_id)?;
    let (m1, _, _) = only_move(ctx, org_id, first)?;
    record_done(ctx, &fixture, m1, 4.0)?;
    validate_stock_picking_backorder(ctx, org_id, first, scope(&fixture))?;

    let backorder = backorder_of(ctx, org_id, first)?;
    confirm_stock_picking(ctx, org_id, backorder, scope(&fixture))?;
    assign_stock_picking(ctx, org_id, backorder, scope(&fixture))?;
    expect_close("reserved for the remainder", reserved(ctx, &fixture), 6.0)?;

    cancel_stock_picking(ctx, org_id, backorder, scope(&fixture))?;

    if picking_state(ctx, backorder)? != "cancel" {
        return Err("The cancelled remainder must be in state cancel".to_string());
    }
    expect_close(
        "reservation after cancelling the remainder",
        reserved(ctx, &fixture),
        0.0,
    )?;
    expect_close("shipped quantity is kept", delivered(ctx, order_id), 4.0)?;
    expect_close("on hand", on_hand(ctx, &fixture), 96.0)?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order missing")?;
    if order.state != SaleState::Sale {
        return Err(format!(
            "Cancelling the remainder keeps the order open, got {:?}",
            order.state
        ));
    }
    // A cancelled picking cannot be validated back into stock movement.
    if validate_stock_picking(ctx, org_id, backorder, scope(&fixture)).is_ok() {
        return Err("A cancelled picking must not validate".to_string());
    }
    Ok(())
}

/// Cancelling a picking that never reserved anything must not release another order's reservation
/// on the same stock.
pub fn test_cancel_unassigned_picking_keeps_other_reservation(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    let order_a = confirmed_order(ctx, &fixture, 10.0, "keep-a")?;
    let order_b = confirmed_order(ctx, &fixture, 10.0, "keep-b")?;
    ready_delivery(ctx, &fixture, order_a)?;
    expect_close("order A reservation", reserved(ctx, &fixture), 10.0)?;

    let picking_b = first_delivery(ctx, org_id, order_b)?;
    confirm_stock_picking(ctx, org_id, picking_b, scope(&fixture))?;
    cancel_stock_picking(ctx, org_id, picking_b, scope(&fixture))?;

    expect_close(
        "order A reservation survives",
        reserved(ctx, &fixture),
        10.0,
    )?;
    if picking_state(ctx, picking_b)? != "cancel" {
        return Err("The unassigned picking must be cancelled".to_string());
    }
    Ok(())
}

/// Another tenant cannot validate or cancel this tenant's picking, and nothing changes.
pub fn test_picking_cross_org_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let org_a = fixture_a.organization_id;
    let order_id = confirmed_order(ctx, &fixture_a, 10.0, "cross-org")?;
    let picking_id = ready_delivery(ctx, &fixture_a, order_id)?;
    let reserved_before = reserved(ctx, &fixture_a);

    if validate_stock_picking(
        ctx,
        fixture_b.organization_id,
        picking_id,
        scope(&fixture_b),
    )
    .is_ok()
    {
        return Err("A foreign organization must not validate this picking".to_string());
    }
    if cancel_stock_picking(
        ctx,
        fixture_b.organization_id,
        picking_id,
        scope(&fixture_b),
    )
    .is_ok()
    {
        return Err("A foreign organization must not cancel this picking".to_string());
    }
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking missing")?;
    if picking.state != "assigned" || picking.organization_id != org_a {
        return Err("A rejected cross-tenant call must not change the picking".to_string());
    }
    expect_close("reservation", reserved(ctx, &fixture_a), reserved_before)?;
    expect_close("delivered", delivered(ctx, order_id), 0.0)?;
    Ok(())
}
