//! Persisted-data evidence for Phase 1 landed-cost tenant and relation checks.

use spacetimedb::{ReducerContext, Table};

use crate::purchasing::landed_costs::stock_landed_cost;
use crate::purchasing::landed_costs::{
    add_landed_cost_line, create_landed_cost, update_landed_cost, CreateLandedCostParams,
    UpdateLandedCostParams,
};
use crate::test_harness::{ensure_test_superuser, PurchasingIntegrityFixture};

pub fn test_landed_cost_scope_and_create_contract(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let marker = "phase1-landed-cost-scope".to_string();
    let valid_params = CreateLandedCostParams {
        date: ctx.timestamp,
        target_move: "distinctive-phase1-target".to_string(),
        currency_id: fixture.primary.currency_id,
        amount_total: 913.42,
        picking_ids: vec![fixture.primary.picking_id],
        cost_lines: vec![],
        valuation_adjustment_lines: vec![],
        account_move_id: None,
        account_journal_id: Some(fixture.primary.journal_id),
        vendor_bill_id: None,
        description: Some("Phase 1 scoped landed cost".to_string()),
        activity_ids: vec![],
        message_follower_ids: vec![],
        message_ids: vec![],
        metadata: Some(marker.clone()),
    };

    create_landed_cost(
        ctx,
        fixture.primary.organization_id,
        fixture.primary.company_id,
        valid_params.clone(),
    )?;
    let persisted = ctx
        .db
        .stock_landed_cost()
        .iter()
        .filter(|row| row.metadata.as_deref() == Some(marker.as_str()))
        .max_by_key(|row| row.id)
        .ok_or("persisted Phase 1 landed cost is missing")?;
    if persisted.organization_id != fixture.primary.organization_id
        || persisted.company_id != fixture.primary.company_id
        || persisted.currency_id != fixture.primary.currency_id
        || persisted.picking_ids != vec![fixture.primary.picking_id]
    {
        return Err("persisted landed cost does not retain the validated relation scope".into());
    }

    let foreign_picking = CreateLandedCostParams {
        picking_ids: vec![fixture.foreign.picking_id],
        metadata: Some(format!("{marker}-foreign-picking")),
        ..valid_params.clone()
    };
    if create_landed_cost(
        ctx,
        fixture.primary.organization_id,
        fixture.primary.company_id,
        foreign_picking,
    )
    .is_ok()
    {
        return Err("cross-organization picking was accepted for landed cost creation".into());
    }

    let cross_company_picking = CreateLandedCostParams {
        metadata: Some(format!("{marker}-cross-company")),
        ..valid_params
    };
    if create_landed_cost(
        ctx,
        fixture.primary.organization_id,
        fixture.cross_company_id,
        cross_company_picking,
    )
    .is_ok()
    {
        return Err("cross-company picking was accepted for landed cost creation".into());
    }

    if update_landed_cost(
        ctx,
        fixture.foreign.organization_id,
        persisted.id,
        UpdateLandedCostParams {
            date: None,
            target_move: None,
            currency_id: None,
            amount_total: None,
            picking_ids: None,
            description: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("cross-organization landed cost update was accepted".into());
    }

    if add_landed_cost_line(
        ctx,
        fixture.foreign.organization_id,
        persisted.id,
        crate::purchasing::landed_costs::AddLandedCostLineParams {
            product_id: fixture.primary.product_id,
            price_unit: 71.25,
            split_method: crate::types::SplitMethod::Equal,
            currency_id: fixture.primary.currency_id,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("cross-organization landed cost line was accepted".into());
    }

    Ok(())
}
