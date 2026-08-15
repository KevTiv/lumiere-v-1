//! Work-center and loss-category tests for the manufacturing domain.
use spacetimedb::ReducerContext;

use crate::manufacturing::work_centers::{
    create_loss_category, create_workcenter, mrp_loss_category, mrp_workcenter,
    CreateLossCategoryParams, CreateWorkcenterParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

/// Positive: create a work center and verify it appears in the table.
pub fn test_workcenter_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_workcenter(
        ctx,
        org_id,
        CreateWorkcenterParams {
            company_id: Some(company_id),
            name: "Assembly Line 1".to_string(),
            active: true,
            code: Some("AL1".to_string()),
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
            metadata: None,
        },
    )?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .mrp_workcenter_by_org()
        .filter(&org_id)
        .find(|w| w.name == "Assembly Line 1")
        .ok_or("Work center not found after create")?;

    if wc.company_id != company_id {
        return Err(format!(
            "Expected company_id={}, got {}",
            company_id, wc.company_id
        ));
    }
    if wc.capacity != 1.0 {
        return Err(format!("Expected capacity=1.0, got {}", wc.capacity));
    }
    if !wc.active {
        return Err("Work center should be active".to_string());
    }

    log::info!("test_workcenter_create passed (wc.id={})", wc.id);
    Ok(())
}

/// Negative: creating a work center with a mismatched company must be rejected
/// (using two separate fixtures with distinct orgs).
pub fn test_workcenter_cross_org_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    // Try to create a work center in org A but with company from org B.
    let result = create_workcenter(
        ctx,
        fixture_a.organization_id,
        CreateWorkcenterParams {
            company_id: Some(fixture_b.company_id), // wrong company
            name: "Cross-Org WC".to_string(),
            active: true,
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
            metadata: None,
        },
    );

    match result {
        Err(_) => {
            log::info!("test_workcenter_cross_org_rejected passed (correctly rejected)");
            Ok(())
        }
        Ok(_) => Err(
            "Expected error for cross-org company_id, but create_workcenter succeeded".to_string(),
        ),
    }
}

/// Positive: create a loss category and verify it appears in the table (MFG-009).
pub fn test_loss_category_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_loss_category(
        ctx,
        org_id,
        CreateLossCategoryParams {
            company_id: Some(company_id),
            name: "Machine Breakdown".to_string(),
            category: "availability".to_string(),
            sequence: 10,
            metadata: None,
        },
    )?;

    let cat = ctx
        .db
        .mrp_loss_category()
        .loss_cat_by_org()
        .filter(&org_id)
        .find(|c| c.name == "Machine Breakdown")
        .ok_or("Loss category not found after create")?;

    if cat.category != "availability" {
        return Err(format!(
            "Expected category=availability, got {}",
            cat.category
        ));
    }
    if cat.company_id != company_id {
        return Err(format!(
            "Expected company_id={}, got {}",
            company_id, cat.company_id
        ));
    }
    if !cat.active {
        return Err("Loss category should be active by default".to_string());
    }

    log::info!("test_loss_category_create passed (cat.id={})", cat.id);
    Ok(())
}

/// Negative: creating a loss category with an invalid category string must fail.
pub fn test_loss_category_invalid_type_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let result = create_loss_category(
        ctx,
        fixture.organization_id,
        CreateLossCategoryParams {
            company_id: Some(fixture.company_id),
            name: "Bad Category".to_string(),
            category: "invalid_type".to_string(),
            sequence: 1,
            metadata: None,
        },
    );

    match result {
        Err(_) => {
            log::info!("test_loss_category_invalid_type_rejected passed");
            Ok(())
        }
        Ok(_) => {
            Err("Expected error for invalid loss category type, but create succeeded".to_string())
        }
    }
}
