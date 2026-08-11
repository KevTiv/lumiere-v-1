/// Inventory adjustments domain tests — in-module test helpers.
use spacetimedb::{ReducerContext, Table};

use crate::inventory::inventory_adjustments::{
    adjustment_reason, create_inventory_adjustment, create_stock_inventory, inventory_adjustment,
    stock_inventory, AdjustmentReason, CreateInventoryAdjustmentParams, CreateStockInventoryParams,
};
use crate::inventory::product::product;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_stock_inventory_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_stock_inventory(
        ctx,
        org_id,
        CreateStockInventoryParams {
            company_id: Some(fixture.company_id),
            name: "Harness Cycle Count".to_string(),
            location_ids: vec![fixture.warehouse_id],
            product_ids: vec![fixture.product_id],
            lot_ids: vec![],
            owner_ids: vec![],
            package_ids: vec![],
            accounting_date: None,
            category_id: None,
            counted_mode: "manual".to_string(),
            is_stock_check: false,
            metadata: Some(r#"{"test":"stock_inventory_create"}"#.to_string()),
        },
    )?;

    let inv = ctx
        .db
        .stock_inventory()
        .iter()
        .find(|i| i.organization_id == org_id && i.name == "Harness Cycle Count")
        .ok_or("Stock inventory not found after create")?;

    if inv.state != "draft" {
        return Err(format!("Expected draft state, got {}", inv.state));
    }
    if inv.product_ids != vec![fixture.product_id] {
        return Err("product_ids not persisted correctly".to_string());
    }
    if inv.company_id != fixture.company_id {
        return Err("company_id not scoped correctly".to_string());
    }

    Ok(())
}

pub fn test_inventory_adjustment_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    // Use warehouse id as location stub (harness warehouse row; full location graph is Phase 2)
    let location_id = fixture.warehouse_id;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    // Seed a reason for this test
    let reason = ctx.db.adjustment_reason().insert(AdjustmentReason {
        id: 0,
        organization_id: org_id,
        code: "HARNESS_MANUAL".to_string(),
        description: Some("Harness test reason".to_string()),
        is_active: true,
        is_system: false,
        created_at: ctx.timestamp,
        metadata: None,
    });

    create_inventory_adjustment(
        ctx,
        org_id,
        CreateInventoryAdjustmentParams {
            name: "Harness Qty Fix".to_string(),
            product_id: fixture.product_id,
            location_id,
            quantity_after: 12.0,
            reason_id: reason.id,
            adjustment_type: "inventory".to_string(),
            inventory_id: None,
            lot_id: None,
            package_id: None,
            uom_id: product.uom_id,
            reason_notes: Some("Harness adjustment".to_string()),
            metadata: None,
        },
    )?;

    let adj = ctx
        .db
        .inventory_adjustment()
        .iter()
        .find(|a| a.organization_id == org_id && a.name == "Harness Qty Fix")
        .ok_or("Inventory adjustment not found after create")?;

    // quantity_before is server-derived from stock (0 at stub location); quantity_after is 12.0
    if (adj.quantity_after - 12.0).abs() > f64::EPSILON {
        return Err(format!(
            "quantity_after should be 12.0, got {}",
            adj.quantity_after
        ));
    }
    if adj.state != "draft" {
        return Err(format!("expected draft state, got {}", adj.state));
    }
    if adj.company_id == 0 {
        return Err("company_id must be server-derived (non-zero)".to_string());
    }

    Ok(())
}
