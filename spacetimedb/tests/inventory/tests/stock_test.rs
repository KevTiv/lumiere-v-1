/// Stock quant domain tests — in-module test helpers.
///
/// Full incoming-picking → validate → quant flow requires picking-type/location
/// scaffolding beyond [`OrgFixture::seed_minimal`]; we smoke-test quant creation
/// and quantity updates directly until warehouse graph is seeded in harness.
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::business_changes::business_change;
use crate::core::organization::company;
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
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("Harness company not found")?
        .currency_id;

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
            currency_id: Some(currency_id),
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
    if commits.len() != 1 || commits[0].row_change_count != 4 {
        return Err(format!(
            "stock move should emit one four-row organization commit, got {} / {:?}",
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
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables != ["stock_quant", "stock_quant", "audit_log", "business_change"] {
        return Err(format!(
            "stock move commit source/history row order mismatch: {tables:?}"
        ));
    }
    let audit_id = serde_json::from_str::<serde_json::Value>(&changes[2].row_identity_json)
        .map_err(|error| format!("stock move audit identity invalid: {error}"))?
        .get("id")
        .and_then(serde_json::Value::as_u64)
        .ok_or("stock move audit identity missing")?;
    let history_id = serde_json::from_str::<serde_json::Value>(&changes[3].row_identity_json)
        .map_err(|error| format!("stock move private history identity invalid: {error}"))?
        .get("id")
        .and_then(serde_json::Value::as_u64)
        .ok_or("stock move private history identity missing")?;
    let audit = ctx
        .db
        .audit_log()
        .id()
        .find(&audit_id)
        .ok_or("stock move audit row missing")?;
    let history = ctx
        .db
        .business_change()
        .id()
        .find(&history_id)
        .ok_or("stock move private history row missing")?;
    if history.audit_log_id != audit.id
        || history.organization_id != org_id
        || audit.organization_id != org_id
        || history.record_id != quant.id
        || history.resource != "stock_quant"
        || history.subject_resource != "stock_quant"
        || history.subject_record_id != quant.id
        || audit.table_name != "stock_quant"
        || audit.record_id != quant.id
        || history.operation != "move_stock_quant"
        || history.company_id != fixture.company_id
        || audit.company_id != Some(fixture.company_id)
    {
        return Err("stock move owner commit did not preserve exact audit/private history linkage and scope".into());
    }

    let actual_ids: Vec<u64> = changes
        .iter()
        .take(2)
        .map(|change| {
            serde_json::from_str::<serde_json::Value>(&change.row_identity_json)
                .ok()
                .and_then(|value| value.get("id").and_then(serde_json::Value::as_u64))
                .ok_or_else(|| "stock move commit has invalid row identity".to_string())
        })
        .collect::<Result<_, _>>()?;
    let destination_quant_id = actual_ids
        .iter()
        .copied()
        .find(|id| *id != quant.id)
        .ok_or("stock move commit did not expose destination quant id")?;
    let destination_quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&destination_quant_id)
        .ok_or("Destination quant missing after move")?;
    if destination_quant.location_id != destination_id
        || (destination_quant.quantity - 2.0).abs() > 0.001
    {
        return Err(format!(
            "destination quant {} did not converge to location {} / qty 2",
            destination_quant_id, destination_id
        ));
    }

    let mut expected_ids = vec![quant.id, destination_quant_id];
    expected_ids.sort_unstable();
    if actual_ids != expected_ids {
        return Err(format!(
            "stock move commit row order mismatch: expected {expected_ids:?}, got {actual_ids:?}"
        ));
    }

    // Duplicate compatible destination quants must fail closed rather than being selected by
    // iterator order.
    ctx.db
        .stock_quant()
        .insert(crate::inventory::stock::StockQuant {
            id: 0,
            quantity: 1.0,
            available_quantity: 1.0,
            value: destination_quant.cost,
            ..destination_quant.clone()
        });
    let source_before_ambiguous = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant.id)
        .ok_or("Source quant missing before ambiguity test")?;
    match move_stock_quant(
        ctx,
        org_id,
        quant.id,
        MoveStockQuantParams {
            company_id: Some(fixture.company_id),
            dest_location_id: destination_id,
            quantity: 1.0,
        },
    ) {
        Err(message) if message.contains("Multiple destination quants") => {}
        Err(message) => {
            return Err(format!(
                "expected duplicate destination rejection, got: {message}"
            ))
        }
        Ok(()) => return Err("duplicate destination quants were accepted".to_string()),
    }
    let source_after_ambiguous = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant.id)
        .ok_or("Source quant missing after ambiguity test")?;
    if (source_after_ambiguous.quantity - source_before_ambiguous.quantity).abs() > 0.001 {
        return Err("ambiguous destination move mutated the source quant".to_string());
    }

    Ok(())
}
