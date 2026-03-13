use crate::inventory::inventory_adjustments::*;
/// Test module for inventory adjustments reducers
use spacetimedb::test_utils::{test_reducer, TestContext};

#[test]
fn test_create_stock_inventory() {
    let ctx = TestContext::new();
    let result = create_stock_inventory(
        &ctx,
        1,
        "Test Inventory".to_string(),
        vec![1, 2],
        vec![100, 200],
        vec![],
        vec![],
        vec![],
        "draft".to_string(),
        None,
        None,
        0,
        false,
        false,
        0,
        "manual".to_string(),
        false,
        false,
        None,
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_inventory_adjustment() {
    let ctx = TestContext::new();
    let result = create_inventory_adjustment(
        &ctx,
        1,
        "Test Adjustment".to_string(),
        100,
        200,
        50.0,
        60.0,
        "manual".to_string(),
        "draft".to_string(),
        None,
        None,
        None,
        1,
        10.0,
        None,
        Some(ctx.sender()),
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_replenishment_rule() {
    let ctx = TestContext::new();
    let result = create_replenishment_rule(
        &ctx,
        1,
        100,
        200,
        10.0,
        50.0,
        1,
        None,
        1,
        1.0,
        0,
        None,
        "manual".to_string(),
        None,
        true,
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_picking_wave() {
    let ctx = TestContext::new();
    let result = create_picking_wave(
        &ctx,
        1,
        "Test Wave".to_string(),
        1,
        1,
        "draft".to_string(),
        None,
        None,
        None,
        true,
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_warehouse_task() {
    let ctx = TestContext::new();
    let result = create_warehouse_task(
        &ctx,
        1,
        "Test Task".to_string(),
        "picking".to_string(),
        "draft".to_string(),
        "normal".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        0.0,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_stock_inventory_line() {
    let ctx = TestContext::new();
    let result = create_stock_inventory_line(
        &ctx,
        1,
        1,
        100,
        200,
        None,
        1,
        50.0,
        60.0,
        "draft".to_string(),
        "none".to_string(),
        "product".to_string(),
        true,
        false,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        false,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_stock_cycle_count() {
    let ctx = TestContext::new();
    let result = create_stock_cycle_count(
        &ctx,
        1,
        "Test Cycle Count".to_string(),
        100,
        vec![100, 200],
        vec![10, 20],
        "Product".to_string(),
        "Weekly".to_string(),
        5.0,
        10.0,
        None,
        None,
        1,
        "draft".to_string(),
        None,
        None,
        None,
        None,
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_stock_count_sheet() {
    let ctx = TestContext::new();
    let result = create_stock_count_sheet(
        &ctx, 1, 1, 100, 200, None, 50.0, 60.0, 1, 10.0, 100.0, None, None, None, false, None, None,
    );
    assert!(result.is_ok());
}

#[test]
fn test_create_adjustment_reason() {
    let ctx = TestContext::new();
    let result = create_adjustment_reason(
        &ctx,
        1,
        "DAMAGED".to_string(),
        "Product damaged during transit".to_string(),
        true,
        false,
    );
    assert!(result.is_ok());
}

#[test]
fn test_update_stock_count_sheet() {
    let ctx = TestContext::new();
    let result = create_stock_count_sheet(
        &ctx, 1, 1, 100, 200, None, 50.0, 60.0, 1, 10.0, 100.0, None, None, None, false, None, None,
    );
    assert!(result.is_ok());

    let result = update_stock_count_sheet(&ctx, 1, 1, 70.0, None, None);
    assert!(result.is_ok());
}

#[test]
fn test_process_stock_count_sheet() {
    let ctx = TestContext::new();
    let result = create_stock_count_sheet(
        &ctx, 1, 1, 100, 200, None, 50.0, 60.0, 1, 10.0, 100.0, None, None, None, false, None, None,
    );
    assert!(result.is_ok());

    let result = process_stock_count_sheet(&ctx, 1, 1);
    assert!(result.is_ok());
}
