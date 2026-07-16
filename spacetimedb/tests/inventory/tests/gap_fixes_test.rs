//! Inventory gap fixes — isolation, ATP, lot/serial, FEFO/expiry, replenishment, QC, waves.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::core::organization::{company, create_company, CompanyScopeParams, CreateCompanyParams};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::product::{
    create_product, create_product_supplier_info, product, CreateProductParams,
    CreateProductSupplierInfoParams,
};
use crate::inventory::quality::{
    create_quality_check, fail_quality_check, quality_check, CreateQualityCheckParams,
};
use crate::inventory::replenishment::{
    create_replenishment_rule, execute_replenishment_rule, replenishment_rule,
    CreateReplenishmentRuleParams,
};
use crate::inventory::stock::{
    assign_stock_picking, confirm_stock_picking, create_stock_move, create_stock_picking,
    create_stock_quant, reserve_quantity_at_location, reserve_stock_quant, stock_picking,
    stock_quant, validate_stock_picking, CreateStockMoveParams, CreateStockPickingParams,
    CreateStockQuantParams, StockQuantReserveParams,
};
use crate::inventory::tracking::{
    create_stock_production_lot, create_stock_production_serial, stock_production_lot,
    stock_production_serial, CreateStockProductionLotParams, CreateStockProductionSerialParams,
};
use crate::inventory::warehouse::{create_stock_location, stock_location, CreateStockLocationParams};
use crate::inventory::warehouse_operations::{
    complete_picking_wave, create_picking_wave, picking_wave, release_picking_wave,
    update_warehouse_task_status, warehouse_task, CreatePickingWaveParams,
};
use crate::purchasing::purchase_orders::purchase_order;
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
            serial_id: None,
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

fn past_timestamp(ctx: &ReducerContext) -> Timestamp {
    Timestamp::from_micros_since_unix_epoch(
        ctx.timestamp.to_micros_since_unix_epoch() - 86_400_000_000,
    )
}

fn future_timestamp(ctx: &ReducerContext, days: i64) -> Timestamp {
    Timestamp::from_micros_since_unix_epoch(
        ctx.timestamp.to_micros_since_unix_epoch() + days * 86_400_000_000,
    )
}

/// Expired lot cannot be reserved.
pub fn test_expired_lot_blocked_on_reserve(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "lot", "LOT-EXP")?;

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-EXPIRED".to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: Some(past_timestamp(ctx)),
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 2.0,
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
        .find(|l| l.organization_id == org_id && l.name == "LOT-EXPIRED")
        .map(|l| l.id)
        .ok_or("expired lot missing")?;

    let quant_id = create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        2.0,
        Some(lot_id),
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
        Err(msg) if msg.to_lowercase().contains("expir") => Ok(()),
        Err(msg) => Err(format!("Expected expired-lot error, got: {msg}")),
        Ok(()) => Err("expiry block failed: reserved expired lot".into()),
    }
}

/// FEFO: soft reserve prefers the lot that expires sooner.
pub fn test_fefo_prefers_earlier_expiry(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "lot", "LOT-FEFO")?;

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-LATE".to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: Some(future_timestamp(ctx, 30)),
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
    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-EARLY".to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: Some(future_timestamp(ctx, 5)),
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

    let early_id = ctx
        .db
        .stock_production_lot()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "LOT-EARLY")
        .map(|l| l.id)
        .ok_or("early lot")?;
    let late_id = ctx
        .db
        .stock_production_lot()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "LOT-LATE")
        .map(|l| l.id)
        .ok_or("late lot")?;

    // Insert late lot first so FEFO must sort, not rely on insertion order.
    create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        5.0,
        Some(late_id),
    )?;
    create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        5.0,
        Some(early_id),
    )?;

    reserve_quantity_at_location(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        1.0,
    )?;

    let early_q = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| q.organization_id == org_id && q.lot_id == Some(early_id))
        .ok_or("early quant")?;
    let late_q = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| q.organization_id == org_id && q.lot_id == Some(late_id))
        .ok_or("late quant")?;

    if early_q.reserved_quantity < 0.999 {
        return Err(format!(
            "FEFO failed: early lot reserved {}, late {}",
            early_q.reserved_quantity, late_q.reserved_quantity
        ));
    }
    if late_q.reserved_quantity > 0.001 {
        return Err(format!(
            "FEFO failed: late lot should be untouched, reserved {}",
            late_q.reserved_quantity
        ));
    }
    Ok(())
}

/// Move-level serial_id is consumed on validate (free → in_use).
pub fn test_serial_id_on_validate(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "serial", "SER-MOVE")?;
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("serial product")?;

    create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        1.0,
        None,
    )?;

    create_stock_production_serial(
        ctx,
        org_id,
        CreateStockProductionSerialParams {
            company_id: Some(company_id),
            name: "SN-MOVE-1".to_string(),
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
    let serial_id = ctx
        .db
        .stock_production_serial()
        .iter()
        .find(|s| s.organization_id == org_id && s.name == "SN-MOVE-1")
        .map(|s| s.id)
        .ok_or("serial missing")?;

    create_stock_picking(
        ctx,
        org_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: "OUT-SER-MOVE".to_string(),
            picking_type_id: 0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(fixture.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some("serial-move".to_string()),
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
            show_lots_text: false,
            show_reserved: true,
            show_check_availability: true,
            show_validate: true,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: Some(product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("outgoing".to_string()),
            product_tracking: Some("serial".to_string()),
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
            metadata: Some(r#"{"test":"serial_id"}"#.to_string()),
        },
    )?;
    let picking_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "OUT-SER-MOVE")
        .map(|p| p.id)
        .ok_or("picking")?;

    create_stock_move(
        ctx,
        org_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: "Serial move".to_string(),
            product_id,
            product_tmpl_id: product_id,
            product_uom: product.uom_id,
            product_uom_qty: 1.0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            date_expected: ctx.timestamp,
            move_type: "outgoing".to_string(),
            priority: "1".to_string(),
            reference: None,
            sequence: 10,
            origin: Some("serial-move".to_string()),
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
            lot_id: None,
            serial_id: Some(serial_id),
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
    reserve_quantity_at_location(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        1.0,
    )?;
    assign_stock_picking(ctx, org_id, picking_id, scope.clone())?;
    validate_stock_picking(ctx, org_id, picking_id, scope)?;

    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("serial after validate")?;
    if serial.state != "in_use" {
        return Err(format!(
            "expected serial in_use after validate with serial_id, got {}",
            serial.state
        ));
    }
    Ok(())
}

/// execute_replenishment_rule creates a draft PO when stock is below min and a vendor exists.
pub fn test_replenishment_creates_draft_po(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Replen Vendor".to_string(),
            type_: "contact".to_string(),
            email: None,
            phone: None,
            mobile: None,
            company_id: Some(company_id),
            is_customer: false,
            is_vendor: true,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 0,
            supplier_rank: 1,
            display_name: Some("Replen Vendor".to_string()),
            first_name: None,
            last_name: None,
            title: None,
            email_secondary: None,
            fax: None,
            website: None,
            street: None,
            street2: None,
            city: None,
            state_code: None,
            zip: None,
            country_code: None,
            tax_id: None,
            company_registry: None,
            industry: None,
            employees_count: None,
            annual_revenue: None,
            description: None,
            salesperson_id: None,
            assigned_user_id: None,
            parent_id: None,
            user_id: None,
            color: None,
            metadata: Some(r#"{"test":"replen"}"#.to_string()),
        },
    )?;
    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.display_name == "Replen Vendor")
        .map(|c| c.id)
        .ok_or("vendor")?;

    create_product_supplier_info(
        ctx,
        org_id,
        CreateProductSupplierInfoParams {
            partner_id: vendor_id,
            product_tmpl_id: Some(fixture.product_id),
            product_id: Some(fixture.product_id),
            min_qty: 1.0,
            price: 12.0,
            currency_id: 1,
            delay: 3,
            sequence: 1,
            product_name: None,
            product_code: None,
            date_start: None,
            date_end: None,
        },
    )?;

    // Destination location has no stock → below min.
    create_replenishment_rule(
        ctx,
        org_id,
        company_id,
        CreateReplenishmentRuleParams {
            product_id: fixture.product_id,
            location_id: fixture.warehouse_id,
            warehouse_id: Some(fixture.warehouse_id),
            uom_id: product.uom_id,
            product_min_qty: 10.0,
            product_max_qty: 20.0,
            qty_multiple: 5.0,
            lead_days: 2,
            route_id: None,
            trigger: "manual".to_string(),
            group_id: None,
            active: true,
            last_run: None,
            next_run: None,
            metadata: None,
        },
    )?;
    let rule_id = ctx
        .db
        .replenishment_rule()
        .iter()
        .find(|r| r.organization_id == org_id && r.product_id == fixture.product_id)
        .map(|r| r.id)
        .ok_or("rule missing")?;

    execute_replenishment_rule(ctx, org_id, company_id, rule_id)?;

    let po = ctx
        .db
        .purchase_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.partner_ref == Some(format!("RPL-{rule_id}"))
        })
        .ok_or("expected draft PO from replenishment")?;
    use crate::types::PoState;
    if po.state != PoState::Draft {
        return Err(format!("expected draft PO, got {:?}", po.state));
    }

    let rule = ctx
        .db
        .replenishment_rule()
        .id()
        .find(&rule_id)
        .ok_or("rule after execute")?;
    if rule.last_run.is_none() {
        return Err("expected last_run stamped".into());
    }
    let meta = rule.metadata.unwrap_or_default();
    if !meta.contains("buy") {
        return Err(format!("expected demand_type buy in metadata, got {meta}"));
    }
    Ok(())
}

/// fail_quality_check moves qty to QC location and removes it from ATP.
pub fn test_quality_fail_quarantines_from_atp(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = fixture.product_id;

    create_quant_for_fixture(ctx, &fixture, 10.0)?;

    create_stock_location(
        ctx,
        org_id,
        CreateStockLocationParams {
            name: "QC Quarantine".to_string(),
            usage: "internal_qc".to_string(),
            location_category: "qc".to_string(),
            parent_path: "/".to_string(),
            child_left: 0,
            child_right: 0,
            scrap_location: false,
            return_location: false,
            active: true,
            posx: 0.0,
            posy: 0.0,
            posz: 0.0,
            cyclic_inventory_frequency: 0,
            location_id: None,
            complete_name: Some("QC Quarantine".to_string()),
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            comment: None,
            barcode: None,
            last_inventory_date: None,
            next_inventory_date: None,
            metadata: Some(r#"{"test":"qc"}"#.to_string()),
        },
    )?;
    let qc_loc = ctx
        .db
        .stock_location()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "QC Quarantine")
        .map(|l| l.id)
        .ok_or("qc location missing")?;

    create_quality_check(
        ctx,
        org_id,
        company_id,
        CreateQualityCheckParams {
            name: "QC-FAIL-1".to_string(),
            test_type: "passfail".to_string(),
            product_id: Some(product_id),
            product_variant_id: None,
            picking_id: None,
            move_line_id: None,
            lot_id: None,
            team_id: None,
            user_id: None,
            control_point_id: None,
            qty_tested: 10.0,
            tolerance_min: None,
            tolerance_max: None,
            norm_unit: None,
            metadata: None,
        },
    )?;
    let check_id = ctx
        .db
        .quality_check()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "QC-FAIL-1")
        .map(|c| c.id)
        .ok_or("quality check missing")?;

    fail_quality_check(
        ctx,
        org_id,
        company_id,
        check_id,
        4.0,
        Some("failed sample".to_string()),
        None,
        Some(qc_loc),
    )?;

    let src = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == org_id
                && q.product_id == product_id
                && q.location_id == fixture.warehouse_id
        })
        .ok_or("source quant after quarantine")?;
    if (src.quantity - 6.0).abs() > 0.001 {
        return Err(format!(
            "expected source qty 6 after quarantine, got {}",
            src.quantity
        ));
    }

    let qc_quant = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == org_id && q.product_id == product_id && q.location_id == qc_loc
        })
        .ok_or("quarantine quant missing")?;
    if (qc_quant.quantity - 4.0).abs() > 0.001 {
        return Err(format!(
            "expected quarantine qty 4, got {}",
            qc_quant.quantity
        ));
    }
    if qc_quant.available_quantity > 0.001 {
        return Err(format!(
            "quarantine stock must have available_quantity 0, got {}",
            qc_quant.available_quantity
        ));
    }

    match reserve_quantity_at_location(ctx, org_id, company_id, product_id, qc_loc, 1.0) {
        Err(msg)
            if msg.to_lowercase().contains("quarantine")
                || msg.to_lowercase().contains("qc") =>
        {
            Ok(())
        }
        Err(msg) => Err(format!("Expected QC/ATP block, got: {msg}")),
        Ok(()) => Err("quarantine ATP block failed: reserved from QC location".into()),
    }
}

/// Wave release creates pick tasks; validate blocked until tasks done; complete needs done pickings.
pub fn test_wave_release_orchestrates_tasks(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = fixture.product_id;
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("product")?;

    create_quant_for_fixture(ctx, &fixture, 5.0)?;

    create_stock_picking(
        ctx,
        org_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: "OUT-WAVE-1".to_string(),
            picking_type_id: 0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(fixture.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some("wave-test".to_string()),
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
            has_tracking: false,
            date: None,
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: false,
            show_lots_text: false,
            show_reserved: true,
            show_check_availability: true,
            show_validate: true,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: Some(product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("outgoing".to_string()),
            product_tracking: None,
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
            metadata: Some(r#"{"test":"wave"}"#.to_string()),
        },
    )?;
    let picking_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "OUT-WAVE-1")
        .map(|p| p.id)
        .ok_or("picking missing")?;

    create_stock_move(
        ctx,
        org_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: "Wave pick move".to_string(),
            product_id,
            product_tmpl_id: product_id,
            product_uom: product.uom_id,
            product_uom_qty: 2.0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            date_expected: ctx.timestamp,
            move_type: "outgoing".to_string(),
            priority: "1".to_string(),
            reference: None,
            sequence: 10,
            origin: Some("wave-test".to_string()),
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
            has_tracking: false,
            inventory_id: None,
            sale_line_id: None,
            lot_id: None,
            serial_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            package_level_id: None,
            product_type: Some("product".to_string()),
            metadata: None,
        },
    )?;

    create_picking_wave(
        ctx,
        org_id,
        company_id,
        CreatePickingWaveParams {
            name: "WAVE-1".to_string(),
            picking_type_id: 0,
            state: "draft".to_string(),
            is_wave: true,
            picking_ids: vec![picking_id],
            move_line_ids: vec![],
            user_id: None,
            team_id: None,
            date_start: None,
            date_done: None,
            metadata: None,
        },
    )?;
    let wave_id = ctx
        .db
        .picking_wave()
        .iter()
        .find(|w| w.organization_id == org_id && w.name == "WAVE-1")
        .map(|w| w.id)
        .ok_or("wave missing")?;

    release_picking_wave(ctx, org_id, company_id, wave_id)?;

    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("picking after release")?;
    if picking.state != "assigned" {
        return Err(format!(
            "expected picking assigned after wave release, got {}",
            picking.state
        ));
    }

    let task_id = ctx
        .db
        .warehouse_task()
        .iter()
        .find(|t| {
            t.organization_id == org_id
                && t.picking_id == Some(picking_id)
                && t.notes
                    .as_deref()
                    .map(|n| n.contains(&format!("wave:{wave_id}")))
                    .unwrap_or(false)
        })
        .map(|t| t.id)
        .ok_or("pick task missing after wave release")?;

    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };

    match validate_stock_picking(ctx, org_id, picking_id, scope.clone()) {
        Err(msg) if msg.to_lowercase().contains("warehouse task") => {}
        Err(msg) => return Err(format!("Expected open-task block on validate, got: {msg}")),
        Ok(()) => return Err("validate should block while wave tasks are open".into()),
    }

    match complete_picking_wave(ctx, org_id, company_id, wave_id) {
        Err(msg) if msg.to_lowercase().contains("open pick task") => {}
        Err(msg) => return Err(format!("Expected open-task block on complete, got: {msg}")),
        Ok(()) => return Err("complete should block while pick tasks are open".into()),
    }

    update_warehouse_task_status(ctx, org_id, company_id, task_id, "done".to_string())?;

    match complete_picking_wave(ctx, org_id, company_id, wave_id) {
        Err(msg) if msg.to_lowercase().contains("validated") || msg.contains("done") => {}
        Err(msg) => {
            return Err(format!(
                "Expected picking-not-done block on complete, got: {msg}"
            ))
        }
        Ok(()) => return Err("complete should block until picking is validated".into()),
    }

    reserve_quantity_at_location(ctx, org_id, company_id, product_id, fixture.warehouse_id, 2.0)?;
    validate_stock_picking(ctx, org_id, picking_id, scope)?;
    complete_picking_wave(ctx, org_id, company_id, wave_id)?;

    let wave = ctx
        .db
        .picking_wave()
        .id()
        .find(&wave_id)
        .ok_or("wave after complete")?;
    if wave.state != "done" {
        return Err(format!("expected wave done, got {}", wave.state));
    }
    Ok(())
}
