//! Persisted COV-07m proof: a BOM routing materializes exactly once, respects
//! every predecessor, and preserves workcenter/time ownership through execution.

use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::inventory::product::product;
use crate::inventory::warehouse::warehouse;
use crate::manufacturing::bill_of_materials::{
    create_bom, create_routing_workcenter, mrp_bom, mrp_routing_workcenter, set_bom_operations,
    update_bom, CreateBomParams, CreateRoutingWorkcenterParams, MrpRoutingWorkcenter,
    UpdateBomParams,
};
use crate::manufacturing::manufacturing_orders::{
    confirm_manufacturing_order, create_manufacturing_order, create_workorder, finish_workorder,
    mrp_production, mrp_workorder, start_manufacturing_order, start_workorder,
    CreateMrpProductionParams, CreateWorkorderParams,
};
use crate::manufacturing::work_centers::{
    create_workcenter, log_workcenter_productivity, mrp_workcenter, mrp_workcenter_productivity,
    CreateWorkcenterParams, CreateWorkcenterProductivityParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{BomType, WorkorderState};

fn center(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_workcenter(
        ctx,
        fixture.organization_id,
        CreateWorkcenterParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            active: true,
            code: None,
            working_state: "normal".to_string(),
            oee_target: 85.0,
            time_efficiency: 50.0,
            capacity: 2.0,
            capacity_ids: vec![],
            alternative_workcenter_ids: vec![],
            color: None,
            resource_calendar_id: None,
            tag_ids: vec![],
            default_capacity_parent_id: None,
            default_time_efficiency: 100.0,
            default_oee_target: 85.0,
            sequence: 10,
            metadata: None,
        },
    )?;
    ctx.db
        .mrp_workcenter()
        .mrp_workcenter_by_org()
        .filter(&fixture.organization_id)
        .find(|row| row.name == name)
        .map(|row| row.id)
        .ok_or("routing center missing".to_string())
}

fn operation(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    center_id: u64,
    name: &str,
    sequence: u32,
    blockers: Vec<u64>,
) -> Result<u64, String> {
    create_routing_workcenter(
        ctx,
        fixture.organization_id,
        CreateRoutingWorkcenterParams {
            workcenter_id: center_id,
            name: name.to_string(),
            worksheet_type: "text".to_string(),
            time_mode: "manual".to_string(),
            time_mode_batch: 1,
            time_cycle_manual: 10.0,
            time_cycle: 0.0,
            sequence,
            worksheet: Some(name.to_string()),
            worksheet_google_slide: None,
            worksheet_url: None,
            blocked_by_operation_ids: blockers,
            metadata: None,
        },
    )?;
    ctx.db
        .mrp_routing_workcenter()
        .mrp_routing_by_org()
        .filter(&fixture.organization_id)
        .find(|row| row.name == name)
        .map(|row| row.id)
        .ok_or("routing operation missing".to_string())
}

/// Tests a three-operation fork/join route, including the second predecessor
/// omitted by the legacy singular blocker projection.
pub fn test_bom_routing_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let wc = center(ctx, &fixture, "COV-07M Routing")?;
    let other_wc = center(ctx, &fixture, "COV-07M Other")?;
    let foreign_wc = center(ctx, &foreign, "COV-07M Foreign")?;
    let first = operation(ctx, &fixture, wc, "COV-07M Cut", 10, vec![])?;
    let second = operation(ctx, &fixture, wc, "COV-07M Prepare", 20, vec![])?;
    let join = operation(
        ctx,
        &fixture,
        wc,
        "COV-07M Assemble",
        30,
        vec![second, first],
    )?;
    let out_of_order = operation(ctx, &fixture, wc, "COV-07M Early", 5, vec![first])?;
    let foreign_op = operation(ctx, &foreign, foreign_wc, "COV-07M Foreign Op", 10, vec![])?;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("routing product missing")?;
    let wh = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("routing warehouse missing")?;
    create_bom(
        ctx,
        fixture.organization_id,
        CreateBomParams {
            company_id: Some(fixture.company_id),
            type_: BomType::Manufacture,
            product_id: product.id,
            product_qty: 1.0,
            product_uom_id: product.uom_id,
            ready_to_produce: "all_available".to_string(),
            consumption: "flexible".to_string(),
            sequence: 10,
            lines: vec![],
            picking_type_id: None,
            location_src_id: Some(fixture.location_id),
            location_dest_id: Some(fixture.location_id),
            warehouse_id: Some(wh.id),
            routing_id: None,
            metadata: None,
        },
    )?;
    let bom = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_product()
        .filter(&product.id)
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("routing BOM missing")?;
    for ids in [
        vec![first, first],
        vec![join],
        vec![first, out_of_order],
        vec![foreign_op],
    ] {
        if set_bom_operations(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            bom.id,
            ids,
        )
        .is_ok()
        {
            return Err("invalid BOM operation ownership/dependency was accepted".to_string());
        }
        if !ctx
            .db
            .mrp_bom()
            .id()
            .find(&bom.id)
            .ok_or("BOM missing")?
            .operation_ids
            .is_empty()
        {
            return Err("rejected routing assignment mutated BOM ownership".to_string());
        }
    }
    // Corrupt a legacy dependency into a cycle: assignment must reject it
    // without altering the BOM, even though creation never permits cycles.
    let first_row = ctx
        .db
        .mrp_routing_workcenter()
        .id()
        .find(&first)
        .ok_or("first operation missing")?;
    ctx.db
        .mrp_routing_workcenter()
        .id()
        .update(MrpRoutingWorkcenter {
            blocked_by_operation_ids: vec![join],
            ..first_row.clone()
        });
    let accepted_cycle = set_bom_operations(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        bom.id,
        vec![first, second, join],
    )
    .is_ok();
    ctx.db.mrp_routing_workcenter().id().update(first_row);
    if accepted_cycle {
        return Err("cyclic legacy BOM routing was accepted".to_string());
    }
    set_bom_operations(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        bom.id,
        vec![join, second, first],
    )?;
    if ctx
        .db
        .mrp_bom()
        .id()
        .find(&bom.id)
        .ok_or("BOM missing")?
        .operation_ids
        != vec![first, second, join]
    {
        return Err("BOM routing order is not canonical".to_string());
    }
    create_manufacturing_order(
        ctx,
        fixture.organization_id,
        CreateMrpProductionParams {
            company_id: Some(fixture.company_id),
            product_id: product.id,
            product_qty: 5.0,
            product_uom_id: product.uom_id,
            date_planned_start: ctx.timestamp,
            date_planned_finished: ctx.timestamp + Duration::from_secs(3600),
            location_src_id: wh.lot_stock_id,
            location_dest_id: wh.lot_stock_id,
            warehouse_id: wh.id,
            picking_type_id: wh.pick_type_id,
            consumption: None,
            bom_id: Some(bom.id),
            routing_id: None,
            proc_group_id: None,
            procurement_group_id: None,
            date_deadline: None,
            origin: Some("COV-07M-ROUTED".to_string()),
            responsible_user_id: None,
            metadata: None,
        },
    )?;
    let mo = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&fixture.organization_id)
        .find(|row| row.origin.as_deref() == Some("COV-07M-ROUTED"))
        .ok_or("routed MO missing")?;
    let manual = CreateWorkorderParams {
        workcenter_id: other_wc,
        production_id: mo.id,
        duration_expected: 1.0,
        name: "Invalid extra".to_string(),
        sequence: 1,
        capacity: None,
        worksheet: None,
        worksheet_url: None,
        operation_note: None,
        operation_id: Some(first),
        blocked_by_workorder_id: None,
        metadata: None,
    };
    if create_workorder(ctx, fixture.organization_id, manual.clone()).is_ok() {
        return Err("routed MO accepted caller-owned workorder".to_string());
    }
    confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    let parent = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("confirmed MO missing")?;
    let mut rows: Vec<_> = ctx
        .db
        .mrp_workorder()
        .mrp_workorder_by_production()
        .filter(&mo.id)
        .collect();
    rows.sort_by_key(|row| row.id);
    if rows.len() != 3
        || parent.workorder_ids != rows.iter().map(|row| row.id).collect::<Vec<_>>()
        || rows.iter().map(|row| row.operation_id).collect::<Vec<_>>()
            != vec![Some(first), Some(second), Some(join)]
        || rows.iter().any(|row| {
            row.workcenter_id != wc
                || row.company_id != fixture.company_id
                || row.organization_id != fixture.organization_id
                || row.production_id != mo.id
                || row.product_id != product.id
                || row.state != WorkorderState::Pending
                || (row.duration_expected - 60.0).abs() > 1e-9
                || row.capacity != 2.0
        })
        || rows[2].blocked_by_workorder_id != Some(rows[0].id)
    {
        return Err("generated routing ownership/duration/blocker mismatch".to_string());
    }
    if confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id).is_ok()
        || create_workorder(ctx, fixture.organization_id, manual).is_ok()
        || set_bom_operations(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            bom.id,
            vec![],
        )
        .is_ok()
        || ctx
            .db
            .mrp_workorder()
            .mrp_workorder_by_production()
            .filter(&mo.id)
            .count()
            != 3
    {
        return Err("routing replay/edit protection failed".to_string());
    }
    if update_bom(
        ctx,
        fixture.organization_id,
        bom.id,
        UpdateBomParams {
            product_qty: Some(2.0),
            ready_to_produce: None,
            consumption: None,
            sequence: None,
            picking_type_id: None,
            location_src_id: None,
            location_dest_id: None,
            warehouse_id: None,
            routing_id: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("confirmed routing quantity basis was editable".to_string());
    }
    start_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    for (index, row) in rows.iter().enumerate() {
        if index < 2
            && start_workorder(ctx, fixture.organization_id, fixture.company_id, rows[2].id).is_ok()
        {
            return Err("join started without every predecessor Done".to_string());
        }
        start_workorder(ctx, fixture.organization_id, fixture.company_id, row.id)?;
        log_workcenter_productivity(
            ctx,
            fixture.organization_id,
            wc,
            CreateWorkcenterProductivityParams {
                workorder_id: row.id,
                loss_id: None,
                description: Some("routing proof".to_string()),
                duration: 12.0 + index as f64,
                metadata: None,
            },
        )?;
        finish_workorder(ctx, fixture.organization_id, fixture.company_id, row.id)?;
        let done = ctx
            .db
            .mrp_workorder()
            .id()
            .find(&row.id)
            .ok_or("finished routing workorder missing")?;
        let logs: Vec<_> = ctx
            .db
            .mrp_workcenter_productivity()
            .mrp_productivity_by_workorder()
            .filter(&row.id)
            .collect();
        if done.state != WorkorderState::Done
            || done.duration != 12.0 + index as f64
            || done.time_ids != logs.iter().map(|log| log.id).collect::<Vec<_>>()
            || logs.len() != 1
            || logs[0].date_end.is_none()
            || done.date_start.is_none()
            || done.date_finished.is_none()
        {
            return Err("routing execution time identities mismatch".to_string());
        }
    }
    let center = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&wc)
        .ok_or("routing center missing")?;
    if center.order_ids != parent.workorder_ids
        || center.workorder_count != 3
        || center.workorder_pending_count != 0
        || center.workorder_progress_count != 0
        || (center.productive_time - 39.0).abs() > 1e-9
        || center.productivity_ids.len() != 3
    {
        return Err("routing workcenter projection mismatch".to_string());
    }
    Ok(())
}
