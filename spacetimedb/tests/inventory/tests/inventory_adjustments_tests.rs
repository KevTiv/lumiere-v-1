/// Inventory adjustments domain tests — in-module test helpers.
use spacetimedb::{ReducerContext, Table};

use crate::inventory::inventory_adjustments::{
    create_inventory_adjustment, create_stock_inventory, inventory_adjustment, stock_inventory,
    CreateInventoryAdjustmentParams, CreateStockInventoryParams,
};
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
            state: "draft".to_string(),
            accounting_date: None,
            category_id: None,
            counted_mode: "manual".to_string(),
            done_move_ids: vec![],
            move_ids: vec![],
            adjustment_count: 0,
            has_account_moves: false,
            exhausted: false,
            prefilled_count: 0,
            started: false,
            is_editable: true,
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

    create_inventory_adjustment(
        ctx,
        org_id,
        CreateInventoryAdjustmentParams {
            name: "Harness Qty Fix".to_string(),
            product_id: fixture.product_id,
            location_id,
            quantity_before: 10.0,
            quantity_after: 12.0,
            reason_code: "manual".to_string(),
            state: "draft".to_string(),
            adjustment_type: "inventory".to_string(),
            inventory_id: None,
            lot_id: None,
            package_id: None,
            uom_id: 1,
            unit_cost: 10.0,
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

    if (adj.difference - 2.0).abs() > f64::EPSILON {
        return Err(format!("difference should be 2.0, got {}", adj.difference));
    }
    if (adj.total_value - 20.0).abs() > f64::EPSILON {
        return Err(format!(
            "total_value should be 20.0, got {}",
            adj.total_value
        ));
    }

    Ok(())
}
