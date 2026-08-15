//! Persisted relational-integrity tests for work orders and productivity logs.

use std::time::Duration;

use spacetimedb::ReducerContext;

use crate::inventory::product::product;
use crate::inventory::warehouse::warehouse;
use crate::manufacturing::manufacturing_orders::{
    create_manufacturing_order, create_workorder, mrp_production, mrp_workorder,
    CreateMrpProductionParams, CreateWorkorderParams, MrpProduction, MrpWorkorder,
};
use crate::manufacturing::work_centers::{
    create_loss_category, create_workcenter, log_workcenter_productivity, mrp_loss_category,
    mrp_workcenter, mrp_workcenter_productivity, CreateLossCategoryParams, CreateWorkcenterParams,
    CreateWorkcenterProductivityParams, MrpLossCategory, MrpWorkcenter,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn create_test_workcenter(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    active: bool,
) -> Result<MrpWorkcenter, String> {
    create_workcenter(
        ctx,
        fixture.organization_id,
        CreateWorkcenterParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            active,
            code: None,
            working_state: "normal".to_string(),
            oee_target: 85.0,
            time_efficiency: 100.0,
            capacity: 1.0,
            capacity_ids: vec![],
            alternative_workcenter_ids: vec![],
            color: None,
            resource_calendar_id: None,
            tag_ids: vec![],
            default_capacity_parent_id: None,
            default_time_efficiency: 100.0,
            default_oee_target: 85.0,
            sequence: 10,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    ctx.db
        .mrp_workcenter()
        .mrp_workcenter_by_org()
        .filter(&fixture.organization_id)
        .find(|workcenter| workcenter.name == name)
        .ok_or_else(|| format!("workcenter {name} missing after create"))
}

fn create_test_production(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    origin: &str,
) -> Result<MrpProduction, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?;
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("fixture warehouse missing")?;

    create_manufacturing_order(
        ctx,
        fixture.organization_id,
        CreateMrpProductionParams {
            company_id: Some(fixture.company_id),
            product_id: fixture.product_id,
            product_qty: 1.0,
            product_uom_id: product.uom_id,
            date_planned_start: ctx.timestamp,
            date_planned_finished: ctx.timestamp + Duration::from_secs(3_600),
            location_src_id: warehouse.lot_stock_id,
            location_dest_id: warehouse.lot_stock_id,
            warehouse_id: warehouse.id,
            picking_type_id: warehouse.pick_type_id,
            consumption: None,
            bom_id: None,
            routing_id: None,
            proc_group_id: None,
            procurement_group_id: None,
            date_deadline: None,
            origin: Some(origin.to_string()),
            responsible_user_id: None,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    let production = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&fixture.organization_id)
        .find(|production| production.origin.as_deref() == Some(origin))
        .ok_or_else(|| format!("production {origin} missing after create"))?;
    if production.consumption != "flexible" {
        return Err("omitted consumption mode did not persist the flexible default".to_string());
    }
    Ok(production)
}

fn create_test_workorder(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    production_id: u64,
    workcenter_id: u64,
    name: &str,
) -> Result<MrpWorkorder, String> {
    create_workorder(
        ctx,
        fixture.organization_id,
        CreateWorkorderParams {
            workcenter_id,
            production_id,
            duration_expected: 30.0,
            name: name.to_string(),
            sequence: 10,
            capacity: None,
            worksheet: None,
            worksheet_url: None,
            operation_note: None,
            operation_id: None,
            blocked_by_workorder_id: None,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    ctx.db
        .mrp_workorder()
        .mrp_workorder_by_production()
        .filter(&production_id)
        .find(|workorder| workorder.workcenter_id == workcenter_id)
        .ok_or_else(|| format!("workorder {name} missing after create"))
}

fn create_test_loss_category(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
) -> Result<MrpLossCategory, String> {
    create_loss_category(
        ctx,
        fixture.organization_id,
        CreateLossCategoryParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            category: "availability".to_string(),
            sequence: 10,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    ctx.db
        .mrp_loss_category()
        .loss_cat_by_org()
        .filter(&fixture.organization_id)
        .find(|category| category.name == name)
        .ok_or_else(|| format!("loss category {name} missing after create"))
}

fn workorder_count(ctx: &ReducerContext, production_id: u64) -> usize {
    ctx.db
        .mrp_workorder()
        .mrp_workorder_by_production()
        .filter(&production_id)
        .count()
}

fn productivity_count(ctx: &ReducerContext, workcenter_id: u64) -> usize {
    ctx.db
        .mrp_workcenter_productivity()
        .mrp_productivity_by_workcenter()
        .filter(&workcenter_id)
        .count()
}

fn productivity_params(
    workorder_id: u64,
    loss_id: Option<u64>,
) -> CreateWorkcenterProductivityParams {
    CreateWorkcenterProductivityParams {
        workorder_id,
        loss_id,
        description: Some("integrity test".to_string()),
        duration: 5.0,
        metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
    }
}

/// MFG-006/MFG-008: workorder workcenters must exist, be active, and share org/company.
pub fn test_workorder_workcenter_integrity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let production_a = create_test_production(ctx, &fixture_a, "MFG-WC-INTEGRITY-A")?;
    let active_b = create_test_workcenter(ctx, &fixture_b, "MFG Cross Org WC", true)?;
    let inactive_a = create_test_workcenter(ctx, &fixture_a, "MFG Inactive WC", false)?;
    let before = workorder_count(ctx, production_a.id);

    if create_workorder(
        ctx,
        fixture_a.organization_id,
        CreateWorkorderParams {
            workcenter_id: u64::MAX,
            production_id: production_a.id,
            duration_expected: 30.0,
            name: "Missing WC".to_string(),
            sequence: 1,
            capacity: None,
            worksheet: None,
            worksheet_url: None,
            operation_note: None,
            operation_id: None,
            blocked_by_workorder_id: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("create_workorder accepted a missing workcenter_id".to_string());
    }
    if workorder_count(ctx, production_a.id) != before {
        return Err("missing workcenter rejection persisted a workorder".to_string());
    }

    for (workcenter_id, label) in [
        (active_b.id, "cross-organization"),
        (inactive_a.id, "inactive"),
    ] {
        if create_workorder(
            ctx,
            fixture_a.organization_id,
            CreateWorkorderParams {
                workcenter_id,
                production_id: production_a.id,
                duration_expected: 30.0,
                name: format!("Rejected {label} WC"),
                sequence: 1,
                capacity: None,
                worksheet: None,
                worksheet_url: None,
                operation_note: None,
                operation_id: None,
                blocked_by_workorder_id: None,
                metadata: None,
            },
        )
        .is_ok()
        {
            return Err(format!("create_workorder accepted a {label} workcenter"));
        }
        if workorder_count(ctx, production_a.id) != before {
            return Err(format!(
                "{label} workcenter rejection persisted a workorder"
            ));
        }
    }

    log::info!("test_workorder_workcenter_integrity passed");
    Ok(())
}

/// MFG-007/MFG-008: productivity references must be active and tenant-compatible.
pub fn test_productivity_relational_integrity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let wc_a = create_test_workcenter(ctx, &fixture_a, "MFG Productivity WC A", true)?;
    let other_wc_a = create_test_workcenter(ctx, &fixture_a, "MFG Productivity WC A2", true)?;
    let wc_b = create_test_workcenter(ctx, &fixture_b, "MFG Productivity WC B", true)?;
    let production_a = create_test_production(ctx, &fixture_a, "MFG-PRODUCTIVITY-A")?;
    let production_b = create_test_production(ctx, &fixture_b, "MFG-PRODUCTIVITY-B")?;
    let workorder_a =
        create_test_workorder(ctx, &fixture_a, production_a.id, wc_a.id, "Productivity A")?;
    let workorder_b =
        create_test_workorder(ctx, &fixture_b, production_b.id, wc_b.id, "Productivity B")?;
    let other_workorder_a = create_test_workorder(
        ctx,
        &fixture_a,
        production_a.id,
        other_wc_a.id,
        "Productivity A2",
    )?;
    let category_a = create_test_loss_category(ctx, &fixture_a, "MFG Loss A")?;
    let category_b = create_test_loss_category(ctx, &fixture_b, "MFG Loss B")?;
    let wc_a_id = wc_a.id;
    let category_a_id = category_a.id;
    let before = productivity_count(ctx, wc_a_id);
    let before_ids = wc_a.productivity_ids.clone();

    for (params, label) in [
        (
            productivity_params(workorder_a.id, Some(u64::MAX)),
            "missing loss category",
        ),
        (
            productivity_params(workorder_a.id, Some(category_b.id)),
            "cross-organization loss category",
        ),
        (
            productivity_params(workorder_b.id, Some(category_a.id)),
            "cross-organization workorder",
        ),
        (
            productivity_params(other_workorder_a.id, Some(category_a.id)),
            "different-workcenter workorder",
        ),
    ] {
        if log_workcenter_productivity(ctx, fixture_a.organization_id, wc_a_id, params).is_ok() {
            return Err(format!("productivity logging accepted a {label}"));
        }
        if productivity_count(ctx, wc_a_id) != before {
            return Err(format!("{label} rejection persisted a productivity row"));
        }
        let current_wc = ctx
            .db
            .mrp_workcenter()
            .id()
            .find(&wc_a_id)
            .ok_or("workcenter missing after rejected productivity call")?;
        if current_wc.productivity_ids != before_ids {
            return Err(format!(
                "{label} rejection mutated workcenter productivity_ids"
            ));
        }
    }

    ctx.db.mrp_loss_category().id().update(MrpLossCategory {
        active: false,
        ..category_a
    });
    if log_workcenter_productivity(
        ctx,
        fixture_a.organization_id,
        wc_a_id,
        productivity_params(workorder_a.id, Some(category_a_id)),
    )
    .is_ok()
    {
        return Err("productivity logging accepted an inactive loss category".to_string());
    }
    if productivity_count(ctx, wc_a_id) != before {
        return Err("inactive loss category rejection persisted a productivity row".to_string());
    }

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        active: false,
        ..wc_a
    });
    if log_workcenter_productivity(
        ctx,
        fixture_a.organization_id,
        wc_a_id,
        productivity_params(workorder_a.id, None),
    )
    .is_ok()
    {
        return Err("productivity logging accepted an inactive workcenter".to_string());
    }
    if productivity_count(ctx, wc_a_id) != before {
        return Err("inactive workcenter rejection persisted a productivity row".to_string());
    }

    log::info!("test_productivity_relational_integrity passed");
    Ok(())
}
