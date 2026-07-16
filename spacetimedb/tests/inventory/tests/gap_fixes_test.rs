//! Pilot-critical inventory gap fixes — company isolation + ATP fail-closed.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::inventory::stock::{
    create_stock_quant, reserve_stock_quant, stock_quant, CreateStockQuantParams,
    StockQuantReserveParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn create_quant_for_fixture(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    quantity: f64,
) -> Result<u64, String> {
    let location_id = fixture.warehouse_id;
    create_stock_quant(
        ctx,
        fixture.organization_id,
        CreateStockQuantParams {
            company_id: Some(fixture.company_id),
            product_id: fixture.product_id,
            product_variant_id: None,
            location_id,
            lot_id: None,
            package_id: None,
            owner_id: None,
            quantity,
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
            metadata: Some(r#"{"test":"gap_fixes"}"#.to_string()),
        },
    )?;

    ctx.db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == fixture.organization_id
                && q.company_id == fixture.company_id
                && q.product_id == fixture.product_id
                && q.location_id == location_id
                && (q.quantity - quantity).abs() < 0.001
        })
        .map(|q| q.id)
        .ok_or_else(|| "quant missing after create".to_string())
}

/// Company B cannot reserve company A's quant in the same organization.
pub fn test_company_isolation_on_reserve(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Iso Company B".to_string(),
            code: format!("CB-{}", fixture.company_id),
            currency_id: 1,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"harness":"iso-b"}"#.to_string()),
        },
    )?;

    let company_b = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_id)
        .map(|c| c.id)
        .filter(|id| *id != fixture.company_id)
        .max()
        .ok_or("company B missing")?;

    let quant_id = create_quant_for_fixture(ctx, &fixture, 10.0)?;

    match reserve_stock_quant(
        ctx,
        org_id,
        quant_id,
        StockQuantReserveParams {
            company_id: Some(company_b),
            reserve_qty: 1.0,
        },
    ) {
        Err(msg) if msg.to_lowercase().contains("belong") || msg.to_lowercase().contains("company") => {
            Ok(())
        }
        Err(msg) => Err(format!("Expected company ownership error, got: {msg}")),
        Ok(()) => Err("company isolation failed: company B reserved company A quant".into()),
    }
}

/// Soft ATP: second reserve beyond available quantity fails closed.
pub fn test_atp_fail_closed_on_over_reserve(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let qty = 5.0;
    let quant_id = create_quant_for_fixture(ctx, &fixture, qty)?;

    reserve_stock_quant(
        ctx,
        org_id,
        quant_id,
        StockQuantReserveParams {
            company_id: Some(fixture.company_id),
            reserve_qty: qty,
        },
    )?;

    let quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("quant after reserve")?;
    if (quant.reserved_quantity - qty).abs() > 0.001 {
        return Err(format!(
            "expected reserved {qty}, got {}",
            quant.reserved_quantity
        ));
    }
    if quant.available_quantity > 0.001 {
        return Err(format!(
            "expected available ~0, got {}",
            quant.available_quantity
        ));
    }

    match reserve_stock_quant(
        ctx,
        org_id,
        quant_id,
        StockQuantReserveParams {
            company_id: Some(fixture.company_id),
            reserve_qty: 0.5,
        },
    ) {
        Err(msg) if msg.to_lowercase().contains("reserve") || msg.to_lowercase().contains("available") => {
            Ok(())
        }
        Err(msg) => Err(format!("Expected ATP shortfall error, got: {msg}")),
        Ok(()) => Err("ATP fail-closed failed: over-reserve succeeded".into()),
    }
}
