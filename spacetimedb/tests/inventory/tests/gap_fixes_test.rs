//! Pilot-critical inventory gap fixes — company isolation, ATP, lot/serial enforcement.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CompanyScopeParams, CreateCompanyParams};
use crate::inventory::product::{create_product, product, CreateProductParams};
use crate::inventory::stock::{
    assign_stock_picking, confirm_stock_picking, create_stock_move, create_stock_picking,
    create_stock_quant, reserve_stock_quant, stock_picking, stock_quant, validate_stock_picking,
    CreateStockMoveParams, CreateStockPickingParams, CreateStockQuantParams, StockQuantReserveParams,
};
use crate::inventory::tracking::{
    create_stock_production_lot, create_stock_production_serial, stock_production_lot,
    stock_production_serial, CreateStockProductionLotParams, CreateStockProductionSerialParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn create_quant_for_fixture(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    quantity: f64,
) -> Result<u64, String> {
    create_quant(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        fixture.product_id,
        fixture.warehouse_id,
        quantity,
        None,
    )
}

fn create_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    quantity: f64,
    lot_id: Option<u64>,
) -> Result<u64, String> {
    create_stock_quant(
        ctx,
        organization_id,
        CreateStockQuantParams {
            company_id: Some(company_id),
            product_id,
            product_variant_id: None,
            location_id,
            lot_id,
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
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.product_id == product_id
                && q.location_id == location_id
                && q.lot_id == lot_id
                && (q.quantity - quantity).abs() < 0.001
        })
        .map(|q| q.id)
        .ok_or_else(|| "quant missing after create".to_string())
}

fn create_tracked_product(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    tracking: &str,
    code: &str,
) -> Result<u64, String> {
    let base = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    create_product(
        ctx,
        fixture.organization_id,
        CreateProductParams {
            name: format!("{} Product {}", tracking, code),
            categ_id: base.categ_id,
            type_: "storable".to_string(),
            uom_id: base.uom_id,
            uom_po_id: base.uom_po_id,
            standard_price: 10.0,
            list_price: 20.0,
            currency_id: 1,
            default_code: Some(code.to_string()),
            barcode: None,
            description: None,
            sale_ok: Some(true),
            purchase_ok: Some(true),
            display_name: None,
            cost_method: None,
            valuation: None,
            volume: None,
            weight: None,
            can_be_expensed: None,
            available_in_pos: None,
            invoicing_policy: None,
            expense_policy: None,
            priority: None,
            is_published: None,
            description_purchase: None,
            description_sale: None,
            service_type: None,
            service_tracking: None,
            image_1920_url: None,
            image_128_url: None,
            color: None,
            responsible_id: None,
            pricelist_id: None,
            description_picking: None,
            description_pickingout: None,
            description_pickingin: None,
            location_id: None,
            warehouse_id: None,
            tracking: Some(tracking.to_string()),
            has_configurable_attributes: None,
            taxes_id: None,
            supplier_taxes_id: None,
            route_ids: None,
            route_from_categ_ids: None,
            property_account_income_id: base.property_account_income_id,
            property_account_expense_id: None,
            variant_attribute_ids: None,
            attribute_line_ids: None,
            metadata: Some(r#"{"test":"tracking"}"#.to_string()),
        },
    )?;

    ctx.db
        .product()
        .product_by_org()
        .filter(&fixture.organization_id)
        .find(|p| p.default_code == Some(code.to_string()))
        .map(|p| p.id)
        .ok_or_else(|| format!("tracked product {code} missing"))
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

/// Lot-tracked product: reserve without lot_id fails; with lot succeeds.
pub fn test_lot_required_on_reserve(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "lot", "LOT-RSV")?;

    let bare_quant = create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        5.0,
        None,
    )?;

    match reserve_stock_quant(
        ctx,
        org_id,
        bare_quant,
        StockQuantReserveParams {
            company_id: Some(company_id),
            reserve_qty: 1.0,
        },
    ) {
        Err(msg) if msg.to_lowercase().contains("lot") => {}
        Err(msg) => return Err(format!("Expected lot-required error, got: {msg}")),
        Ok(()) => return Err("lot enforcement failed: reserved quant without lot".into()),
    }

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-A".to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 5.0,
            location_id: Some(fixture.warehouse_id),
            package_id: None,
            owner_id: None,
            is_scrap: false,
            is_locked: false,
            metadata: None,
        },
    )?;
    let lot_id = ctx
        .db
        .stock_production_lot()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "LOT-A" && l.product_id == product_id)
        .map(|l| l.id)
        .ok_or("lot missing")?;

    let lot_quant = create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        5.0,
        Some(lot_id),
    )?;

    reserve_stock_quant(
        ctx,
        org_id,
        lot_quant,
        StockQuantReserveParams {
            company_id: Some(company_id),
            reserve_qty: 1.0,
        },
    )?;

    Ok(())
}

/// Serial-tracked product: reserve without free serials fails; with free serial reserves it.
pub fn test_serial_required_on_reserve(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "serial", "SER-RSV")?;

    let quant_id = create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        2.0,
        None,
    )?;

    match reserve_stock_quant(
        ctx,
        org_id,
        quant_id,
        StockQuantReserveParams {
            company_id: Some(company_id),
            reserve_qty: 1.0,
        },
    ) {
        Err(msg) if msg.to_lowercase().contains("serial") => {}
        Err(msg) => return Err(format!("Expected serial shortfall error, got: {msg}")),
        Ok(()) => return Err("serial enforcement failed: reserved without free serial".into()),
    }

    create_stock_production_serial(
        ctx,
        org_id,
        CreateStockProductionSerialParams {
            company_id: Some(company_id),
            name: "SN-001".to_string(),
            product_id,
            product_variant_id: None,
            lot_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 1.0,
            location_id: Some(fixture.warehouse_id),
            package_id: None,
            owner_id: None,
            state: "free".to_string(),
            is_scrap: false,
            is_locked: false,
            warranty_expiration: None,
            warranty_start: None,
            last_maintenance: None,
            next_maintenance: None,
            maintenance_count: 0,
            metadata: None,
        },
    )?;

    reserve_stock_quant(
        ctx,
        org_id,
        quant_id,
        StockQuantReserveParams {
            company_id: Some(company_id),
            reserve_qty: 1.0,
        },
    )?;

    let serial = ctx
        .db
        .stock_production_serial()
        .iter()
        .find(|s| s.organization_id == org_id && s.name == "SN-001")
        .ok_or("serial missing after reserve")?;
    if serial.state != "reserved" {
        return Err(format!(
            "expected serial reserved after quant reserve, got {}",
            serial.state
        ));
    }

    Ok(())
}

/// Lot-tracked outbound validate fails closed when move has no lot_id.
pub fn test_lot_required_on_validate(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "lot", "LOT-VAL")?;
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("tracked product missing")?;

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-VAL-A".to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 1.0,
            location_id: Some(fixture.warehouse_id),
            package_id: None,
            owner_id: None,
            is_scrap: false,
            is_locked: false,
            metadata: None,
        },
    )?;
    let lot_id = ctx
        .db
        .stock_production_lot()
        .iter()
        .find(|l| {
            l.organization_id == org_id && l.name == "LOT-VAL-A" && l.product_id == product_id
        })
        .map(|l| l.id)
        .ok_or("lot missing")?;

    create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        1.0,
        Some(lot_id),
    )?;

    create_stock_picking(
        ctx,
        org_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: "OUT-LOT-VAL".to_string(),
            picking_type_id: 0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.warehouse_id,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(fixture.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some("lot-validate".to_string()),
            note: None,
            user_id: None,
            sale_id: None,
            purchase_id: None,
            group_id: None,
            is_locked: false,
            immediate_transfer: false,
            is_printed: false,
            is_return: false,
            has_scrap_move: false,
            has_tracking: true,
            date: None,
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: false,
            show_lots_text: true,
            show_reserved: true,
            show_check_availability: true,
            show_validate: true,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: true,
            product_id: Some(product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("outgoing".to_string()),
            product_tracking: Some("lot".to_string()),
            product_barcode: None,
            move_line_exist: false,
            has_packages: false,
            has_move_lines: true,
            has_package: false,
            has_lot: false,
            has_owner: false,
            has_entire_package_src: false,
            has_entire_package_dest: false,
            package_level_ids: vec![],
            batch_id: None,
            metadata: Some(r#"{"test":"lot_validate"}"#.to_string()),
        },
    )?;

    let picking_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "OUT-LOT-VAL")
        .map(|p| p.id)
        .ok_or("picking missing")?;

    create_stock_move(
        ctx,
        org_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: "Move without lot".to_string(),
            product_id,
            product_tmpl_id: product_id,
            product_uom: product.uom_id,
            product_uom_qty: 1.0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id, // customer/partner loc placeholder
            date_expected: ctx.timestamp,
            move_type: "outgoing".to_string(),
            priority: "1".to_string(),
            reference: None,
            sequence: 10,
            origin: Some("lot-validate".to_string()),
            note: None,
            date: None,
            date_deadline: None,
            picking_id: Some(picking_id),
            picking_type_id: None,
            partner_id: Some(fixture.partner_id),
            product_variant_id: None,
            group_id: None,
            rule_id: None,
            procure_method: "make_to_stock".to_string(),
            price_unit: 20.0,
            scrapped: false,
            to_refund: false,
            propagate_cancel: true,
            delay_alert: false,
            product_packaging_id: None,
            product_packaging_qty: 0.0,
            warehouse_id: Some(fixture.warehouse_id),
            production_id: None,
            raw_material_production_id: None,
            unbuild_id: None,
            consume_unbuild_id: None,
            cost_share: 0.0,
            is_subcontract: false,
            purchase_line_id: None,
            need_release: false,
            release_ready: false,
            propagation_cancel: true,
            has_tracking: true,
            inventory_id: None,
            sale_line_id: None,
            lot_id: None, // intentionally missing
            package_id: None,
            result_package_id: None,
            owner_id: None,
            package_level_id: None,
            product_type: Some("product".to_string()),
            metadata: None,
        },
    )?;

    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };
    confirm_stock_picking(ctx, org_id, picking_id, scope.clone())?;
    // Soft-reserve ATP for the move product before assign/validate.
    let quant_id = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == org_id
                && q.product_id == product_id
                && q.lot_id == Some(lot_id)
        })
        .map(|q| q.id)
        .ok_or("lot quant missing")?;
    reserve_stock_quant(
        ctx,
        org_id,
        quant_id,
        StockQuantReserveParams {
            company_id: Some(company_id),
            reserve_qty: 1.0,
        },
    )?;
    assign_stock_picking(ctx, org_id, picking_id, scope.clone())?;

    match validate_stock_picking(ctx, org_id, picking_id, scope) {
        Err(msg) if msg.to_lowercase().contains("lot") => Ok(()),
        Err(msg) => Err(format!("Expected lot-required on validate, got: {msg}")),
        Ok(()) => Err("lot validate enforcement failed: validated without lot_id".into()),
    }
}
