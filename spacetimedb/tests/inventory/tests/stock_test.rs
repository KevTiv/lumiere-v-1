/// Stock quant domain tests — in-module test helpers.
///
/// Full incoming-picking → validate → quant flow requires picking-type/location
/// scaffolding beyond [`OrgFixture::seed_minimal`]; we smoke-test quant creation
/// and quantity updates directly until warehouse graph is seeded in harness.
use spacetimedb::{ReducerContext, Table};

use crate::core::persistence::{organization_commit, organization_row_change};
use crate::inventory::stock::{
    create_stock_quant, move_stock_quant, stock_quant, update_stock_quant_quantity,
    CreateStockQuantParams, MoveStockQuantParams, UpdateStockQuantQuantityParams,
};
use crate::inventory::warehouse::stock_location;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_stock_quant_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    let location_id = fixture.location_id;
    let initial_qty = 5.0;

    create_stock_quant(
        ctx,
        org_id,
        CreateStockQuantParams {
            company_id: Some(fixture.company_id),
            product_id: fixture.product_id,
            product_variant_id: None,
            location_id,
            lot_id: None,
            package_id: None,
            owner_id: None,
            quantity: initial_qty,
            reserved_quantity: 0.0,
            in_date: Some(ctx.timestamp),
            inventory_quantity: 0.0,
            inventory_diff_quantity: 0.0,
            inventory_quantity_set: false,
            is_outdated: false,
            user_id: None,
            inventory_date: None,
            cost: 10.0,
            cost_method: Some("standard".to_string()),
            accounting_date: None,
            currency_id: Some(1),
            accounting_entry_ids: vec![],
            metadata: Some(r#"{"test":"stock_quant_create"}"#.to_string()),
        },
    )?;

    // Prefer the row we just created (metadata marker). seed_minimal / prior tests may
    // leave other quants on the same product+location in this org.
    let quant = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.product_id == fixture.product_id
                && q.location_id == location_id
                && q.metadata.as_deref() == Some(r#"{"test":"stock_quant_create"}"#)
        })
        .max_by_key(|q| q.id)
        .ok_or("Stock quant not found after create")?;

    if (quant.quantity - initial_qty).abs() > 0.001 {
        return Err(format!(
            "Expected quantity {initial_qty}, got {}",
            quant.quantity
        ));
    }

    // Simulate receipt qty increase without full picking validate path.
    let receipt_delta = 3.0;
    update_stock_quant_quantity(
        ctx,
        org_id,
        quant.id,
        UpdateStockQuantQuantityParams {
            company_id: Some(fixture.company_id),
            quantity: initial_qty + receipt_delta,
        },
    )?;

    let updated = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant.id)
        .ok_or("Stock quant not found after update")?;

    if (updated.quantity - (initial_qty + receipt_delta)).abs() > 0.001 {
        return Err(format!(
            "Expected quantity {} after receipt, got {}",
            initial_qty + receipt_delta,
            updated.quantity
        ));
    }

    let destination_id = ctx
        .db
        .stock_location()
        .iter()
        .find(|location| {
            location.organization_id == org_id
                && location.company_id == Some(fixture.company_id)
                && location.id != location_id
                && location.active
        })
        .map(|location| location.id)
        .ok_or("No second active fixture location for move test")?;
    move_stock_quant(
        ctx,
        org_id,
        quant.id,
        MoveStockQuantParams {
            company_id: Some(fixture.company_id),
            dest_location_id: destination_id,
            quantity: 2.0,
        },
    )?;

    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == org_id
                && commit.operation_id == "erp.move_stock_quant"
                && commit.correlation_id
                    == format!("stock-quant:{}:move-to:{}", quant.id, destination_id)
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 2 {
        return Err(format!(
            "stock move should emit one two-row organization commit, got {} / {:?}",
            commits.len(),
            commits.first().map(|commit| commit.row_change_count)
        ));
    }
    let commit = &commits[0];
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == org_id && change.commit_sequence == commit.sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    if changes.len() != 2
        || changes
            .iter()
            .any(|change| change.table_name != "stock_quant")
    {
        return Err("stock move commit should contain two ordered stock_quant rows".to_string());
    }
    let destination_quant_id = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|quant| quant.organization_id == org_id && quant.location_id == destination_id)
        .map(|quant| quant.id)
        .max()
        .ok_or("Destination quant missing after move")?;
    let mut expected_ids = vec![quant.id, destination_quant_id];
    expected_ids.sort_unstable();
    let actual_ids: Vec<u64> = changes
        .iter()
        .map(|change| {
            serde_json::from_str::<serde_json::Value>(&change.row_identity_json)
                .ok()
                .and_then(|value| value.get("id").and_then(serde_json::Value::as_u64))
                .ok_or_else(|| "stock move commit has invalid row identity".to_string())
        })
        .collect::<Result<_, _>>()?;
    if actual_ids != expected_ids {
        return Err(format!(
            "stock move commit row order mismatch: expected {expected_ids:?}, got {actual_ids:?}"
        ));
    }

    Ok(())
}
