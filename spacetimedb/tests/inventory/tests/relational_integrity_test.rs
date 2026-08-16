//! Persisted negative matrix for inventory foreign-key and tenant guards.

use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::core::reference::uom;
use crate::inventory::inventory_adjustments::{
    adjustment_reason, create_inventory_adjustment, inventory_adjustment, AdjustmentReason,
    CreateInventoryAdjustmentParams,
};
use crate::inventory::product::product;
use crate::inventory::replenishment::{
    create_replenishment_rule, replenishment_rule, CreateReplenishmentRuleParams,
};
use crate::inventory::warehouse::{stock_route, warehouse, StockRoute};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn next_unused_id<I>(ids: I, relation: &str) -> Result<u64, String>
where
    I: Iterator<Item = u64>,
{
    ids.max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| format!("cannot allocate missing {relation} test id"))
}

fn expect_error(result: Result<(), String>, expected: &str, case: &str) -> Result<(), String> {
    match result {
        Err(message) if message.to_lowercase().contains(expected) => Ok(()),
        Err(message) => Err(format!(
            "{case}: expected {expected:?} error, got {message:?}"
        )),
        Ok(()) => Err(format!("{case}: invalid relation was accepted")),
    }
}

fn replenishment_params(
    fixture: &OrgFixture,
    product_id: u64,
    route_id: Option<u64>,
    uom_id: u64,
    location_id: u64,
    marker: &str,
) -> CreateReplenishmentRuleParams {
    CreateReplenishmentRuleParams {
        product_id,
        location_id,
        warehouse_id: Some(fixture.warehouse_id),
        uom_id,
        product_min_qty: 1.0,
        product_max_qty: 2.0,
        qty_multiple: 1.0,
        lead_days: 1,
        route_id,
        trigger: "manual".to_string(),
        group_id: None,
        active: true,
        last_run: None,
        next_run: None,
        metadata: Some(format!(r#"{{"test":"{marker}"}}"#)),
    }
}

fn fixture_stock_location_id(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    ctx.db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .map(|row| row.lot_stock_id)
        .ok_or_else(|| format!("fixture warehouse {} missing", fixture.warehouse_id))
}

fn assert_rule_count_unchanged(
    ctx: &ReducerContext,
    before: usize,
    case: &str,
) -> Result<(), String> {
    let after = ctx.db.replenishment_rule().iter().count();
    if after != before {
        return Err(format!(
            "{case}: rejected request persisted a replenishment rule ({before} -> {after})"
        ));
    }
    Ok(())
}

fn insert_route(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    name: &str,
    active: bool,
    product_selectable: bool,
) -> u64 {
    ctx.db
        .stock_route()
        .insert(StockRoute {
            id: 0,
            organization_id,
            name: name.to_string(),
            sequence: 1,
            active,
            company_id,
            product_selectable,
            product_categ_selectable: false,
            warehouse_selectable: false,
            shipping_selectable: false,
            sale_selectable: false,
            manufacture_selectable: false,
            purchase_selectable: true,
            mto_selectable: false,
            rule_ids: vec![],
            is_active: active,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: Some(r#"{"test":"inventory_relational_integrity"}"#.to_string()),
        })
        .id
}

/// INV-008/009/011: product and route relation guards reject invalid parents atomically.
pub fn test_replenishment_relation_negative_matrix(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let local_product = ctx
        .db
        .product()
        .id()
        .find(&local.product_id)
        .ok_or("local product missing")?;
    let uom_id = local_product.uom_id;
    let location_id = fixture_stock_location_id(ctx, &local)?;

    let missing_product_id = next_unused_id(ctx.db.product().iter().map(|row| row.id), "product")?;
    let mut before = ctx.db.replenishment_rule().iter().count();
    expect_error(
        create_replenishment_rule(
            ctx,
            local.organization_id,
            local.company_id,
            replenishment_params(
                &local,
                missing_product_id,
                None,
                uom_id,
                location_id,
                "missing-product",
            ),
        ),
        "not found",
        "missing product",
    )?;
    assert_rule_count_unchanged(ctx, before, "missing product")?;

    before = ctx.db.replenishment_rule().iter().count();
    expect_error(
        create_replenishment_rule(
            ctx,
            local.organization_id,
            local.company_id,
            replenishment_params(
                &local,
                foreign.product_id,
                None,
                uom_id,
                location_id,
                "cross-org-product",
            ),
        ),
        "organization",
        "cross-organization product",
    )?;
    assert_rule_count_unchanged(ctx, before, "cross-organization product")?;

    let mut product = local_product;
    product.active = false;
    ctx.db.product().id().update(product);
    before = ctx.db.replenishment_rule().iter().count();
    let inactive_result = create_replenishment_rule(
        ctx,
        local.organization_id,
        local.company_id,
        replenishment_params(
            &local,
            local.product_id,
            None,
            uom_id,
            location_id,
            "inactive-product",
        ),
    );
    let mut product = ctx
        .db
        .product()
        .id()
        .find(&local.product_id)
        .ok_or("inactive product disappeared")?;
    product.active = true;
    ctx.db.product().id().update(product);
    expect_error(inactive_result, "archived", "inactive product")?;
    assert_rule_count_unchanged(ctx, before, "inactive product")?;

    let mut product = ctx
        .db
        .product()
        .id()
        .find(&local.product_id)
        .ok_or("local product disappeared")?;
    let original_type = product.type_.clone();
    product.type_ = "service".to_string();
    ctx.db.product().id().update(product);
    before = ctx.db.replenishment_rule().iter().count();
    let service_result = create_replenishment_rule(
        ctx,
        local.organization_id,
        local.company_id,
        replenishment_params(
            &local,
            local.product_id,
            None,
            uom_id,
            location_id,
            "service-product",
        ),
    );
    let mut product = ctx
        .db
        .product()
        .id()
        .find(&local.product_id)
        .ok_or("service product disappeared")?;
    product.type_ = original_type;
    ctx.db.product().id().update(product);
    expect_error(service_result, "service", "service product")?;
    assert_rule_count_unchanged(ctx, before, "service product")?;

    let incompatible_uom_id = next_unused_id(ctx.db.uom().iter().map(|row| row.id), "UOM")?;
    before = ctx.db.replenishment_rule().iter().count();
    expect_error(
        create_replenishment_rule(
            ctx,
            local.organization_id,
            local.company_id,
            replenishment_params(
                &local,
                local.product_id,
                None,
                incompatible_uom_id,
                location_id,
                "incompatible-uom",
            ),
        ),
        "stock uom",
        "incompatible product UOM",
    )?;
    assert_rule_count_unchanged(ctx, before, "incompatible product UOM")?;

    let foreign_route_id = insert_route(
        ctx,
        foreign.organization_id,
        Some(foreign.company_id),
        "Foreign route",
        true,
        true,
    );
    let inactive_route_id = insert_route(
        ctx,
        local.organization_id,
        Some(local.company_id),
        "Inactive route",
        false,
        true,
    );
    let non_product_route_id = insert_route(
        ctx,
        local.organization_id,
        Some(local.company_id),
        "Warehouse-only route",
        true,
        false,
    );
    let valid_route_id = insert_route(
        ctx,
        local.organization_id,
        Some(local.company_id),
        "Valid product route",
        true,
        true,
    );

    let local_company = ctx
        .db
        .company()
        .id()
        .find(&local.company_id)
        .ok_or("local company missing")?;
    create_company(
        ctx,
        local.organization_id,
        CreateCompanyParams {
            name: "Inventory Relation Company B".to_string(),
            code: format!("INV-RI-{}", local.company_id),
            currency_id: local_company.currency_id,
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
            metadata: Some(r#"{"test":"inventory_relational_integrity"}"#.to_string()),
        },
    )?;
    let company_b = ctx
        .db
        .company()
        .company_by_org()
        .filter(&local.organization_id)
        .map(|row| row.id)
        .filter(|id| *id != local.company_id)
        .max()
        .ok_or("inventory relation company B missing")?;
    let other_company_route_id = insert_route(
        ctx,
        local.organization_id,
        Some(company_b),
        "Other company route",
        true,
        true,
    );

    // Compute after all routes above are inserted so this id cannot collide
    // with an auto-inc id assigned to one of them.
    let missing_route_id =
        next_unused_id(ctx.db.stock_route().iter().map(|row| row.id), "stock route")?;

    for (case, route_id, expected) in [
        ("missing route", missing_route_id, "not found"),
        ("cross-organization route", foreign_route_id, "organization"),
        ("cross-company route", other_company_route_id, "company"),
        ("inactive route", inactive_route_id, "inactive"),
        ("non-product route", non_product_route_id, "products"),
    ] {
        before = ctx.db.replenishment_rule().iter().count();
        expect_error(
            create_replenishment_rule(
                ctx,
                local.organization_id,
                local.company_id,
                replenishment_params(
                    &local,
                    local.product_id,
                    Some(route_id),
                    uom_id,
                    location_id,
                    case,
                ),
            ),
            expected,
            case,
        )?;
        assert_rule_count_unchanged(ctx, before, case)?;
    }

    create_replenishment_rule(
        ctx,
        local.organization_id,
        local.company_id,
        replenishment_params(
            &local,
            local.product_id,
            Some(valid_route_id),
            uom_id,
            location_id,
            "valid-route",
        ),
    )?;
    let persisted = ctx
        .db
        .replenishment_rule()
        .iter()
        .find(|row| {
            row.organization_id == local.organization_id
                && row.company_id == local.company_id
                && row.product_id == local.product_id
                && row.route_id == Some(valid_route_id)
        })
        .ok_or("valid replenishment product/route relation was not persisted")?;
    if !persisted.active {
        return Err("valid replenishment relation was persisted inactive".to_string());
    }

    Ok(())
}

fn adjustment_params(
    fixture: &OrgFixture,
    reason_id: u64,
    uom_id: u64,
    location_id: u64,
    name: &str,
) -> CreateInventoryAdjustmentParams {
    CreateInventoryAdjustmentParams {
        name: name.to_string(),
        product_id: fixture.product_id,
        location_id,
        quantity_after: 3.0,
        reason_id,
        adjustment_type: "inventory".to_string(),
        inventory_id: None,
        lot_id: None,
        package_id: None,
        uom_id,
        reason_notes: None,
        metadata: Some(r#"{"test":"inventory_relational_integrity"}"#.to_string()),
    }
}

/// INV-010/011: adjustment reasons enforce existence, tenant, and lifecycle atomically.
pub fn test_adjustment_reason_negative_matrix(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let uom_id = ctx
        .db
        .product()
        .id()
        .find(&local.product_id)
        .map(|row| row.uom_id)
        .ok_or("adjustment matrix product missing")?;
    let location_id = fixture_stock_location_id(ctx, &local)?;

    let foreign_reason = ctx.db.adjustment_reason().insert(AdjustmentReason {
        id: 0,
        organization_id: foreign.organization_id,
        code: "FOREIGN_REASON".to_string(),
        description: None,
        is_active: true,
        is_system: false,
        created_at: ctx.timestamp,
        metadata: None,
    });
    let inactive_reason = ctx.db.adjustment_reason().insert(AdjustmentReason {
        id: 0,
        organization_id: local.organization_id,
        code: "INACTIVE_REASON".to_string(),
        description: None,
        is_active: false,
        is_system: false,
        created_at: ctx.timestamp,
        metadata: None,
    });
    let missing_reason_id = next_unused_id(
        ctx.db.adjustment_reason().iter().map(|row| row.id),
        "adjustment reason",
    )?;

    for (case, reason_id, expected) in [
        ("missing adjustment reason", missing_reason_id, "not found"),
        (
            "cross-organization adjustment reason",
            foreign_reason.id,
            "organization",
        ),
        ("inactive adjustment reason", inactive_reason.id, "inactive"),
    ] {
        let before = ctx.db.inventory_adjustment().iter().count();
        expect_error(
            create_inventory_adjustment(
                ctx,
                local.organization_id,
                adjustment_params(&local, reason_id, uom_id, location_id, case),
            ),
            expected,
            case,
        )?;
        let after = ctx.db.inventory_adjustment().iter().count();
        if after != before {
            return Err(format!(
                "{case}: rejected request persisted an adjustment ({before} -> {after})"
            ));
        }
    }

    Ok(())
}

fn adjustment_product_params(
    product_id: u64,
    reason_id: u64,
    uom_id: u64,
    location_id: u64,
    name: &str,
) -> CreateInventoryAdjustmentParams {
    CreateInventoryAdjustmentParams {
        name: name.to_string(),
        product_id,
        location_id,
        quantity_after: 4.0,
        reason_id,
        adjustment_type: "inventory".to_string(),
        inventory_id: None,
        lot_id: None,
        package_id: None,
        uom_id,
        reason_notes: None,
        metadata: Some(r#"{"test":"inventory_relational_integrity"}"#.to_string()),
    }
}

/// INV-013: adjustment product references enforce existence, tenant, and lifecycle atomically.
pub fn test_adjustment_product_negative_matrix(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let uom_id = ctx
        .db
        .product()
        .id()
        .find(&local.product_id)
        .map(|row| row.uom_id)
        .ok_or("adjustment product matrix product missing")?;
    let location_id = fixture_stock_location_id(ctx, &local)?;

    let reason = ctx.db.adjustment_reason().insert(AdjustmentReason {
        id: 0,
        organization_id: local.organization_id,
        code: "PRODUCT_MATRIX_REASON".to_string(),
        description: None,
        is_active: true,
        is_system: false,
        created_at: ctx.timestamp,
        metadata: None,
    });

    let missing_product_id = next_unused_id(ctx.db.product().iter().map(|row| row.id), "product")?;

    for (case, product_id, expected) in [
        ("missing product", missing_product_id, "not found"),
        (
            "cross-organization product",
            foreign.product_id,
            "organization",
        ),
    ] {
        let before = ctx.db.inventory_adjustment().iter().count();
        expect_error(
            create_inventory_adjustment(
                ctx,
                local.organization_id,
                adjustment_product_params(product_id, reason.id, uom_id, location_id, case),
            ),
            expected,
            case,
        )?;
        let after = ctx.db.inventory_adjustment().iter().count();
        if after != before {
            return Err(format!(
                "{case}: rejected request persisted an adjustment ({before} -> {after})"
            ));
        }
    }

    // Archived (inactive) product must also be rejected.
    if let Some(mut product) = ctx.db.product().id().find(&local.product_id) {
        product.active = false;
        ctx.db.product().id().update(product);
    }
    let before = ctx.db.inventory_adjustment().iter().count();
    expect_error(
        create_inventory_adjustment(
            ctx,
            local.organization_id,
            adjustment_product_params(
                local.product_id,
                reason.id,
                uom_id,
                location_id,
                "inactive product",
            ),
        ),
        "archived",
        "inactive product",
    )?;
    let after = ctx.db.inventory_adjustment().iter().count();
    if after != before {
        return Err(format!(
            "inactive product: rejected request persisted an adjustment ({before} -> {after})"
        ));
    }

    Ok(())
}
