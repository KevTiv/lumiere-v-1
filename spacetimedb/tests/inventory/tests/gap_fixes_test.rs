//! Inventory gap fixes — isolation, ATP, lot/serial, FEFO/expiry, replenishment, QC, waves,
//! UoM conversion, inventory close, 3PL, cartonization, consignment, cross-dock, packing, exceptions.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::core::organization::{company, create_company, CompanyScopeParams, CreateCompanyParams};
use crate::core::reference::{
    create_uom, create_uom_conversion, uom, CreateUomConversionParams, CreateUomParams,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::consignment::{
    activate_consignment_agreement, receive_consignment_stock, ReceiveConsignmentStockParams,
};
use crate::inventory::cross_dock::{execute_cross_dock, ExecuteCrossDockParams};
use crate::inventory::integration::{
    create_inventory_integration_intent, inventory_integration_intent,
    record_inventory_integration_result, CreateInventoryIntegrationIntentParams,
    RecordInventoryIntegrationResultParams,
};
use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::inventory::inventory_close::{
    create_inventory_close, inventory_close, reopen_inventory_close, run_inventory_close,
    CreateInventoryCloseParams, RunInventoryCloseParams,
};
use crate::inventory::exceptions::{
    inventory_exception, refresh_inventory_exceptions, resolve_inventory_exception,
    RefreshInventoryExceptionsParams,
};
use crate::inventory::packing::{
    done_stock_package, pack_stock_picking, stock_package, PackStockPickingParams,
};
use crate::inventory::putaway::{execute_directed_putaway, ExecuteDirectedPutawayParams};
use crate::types::{AccountInternalGroup, JournalType};
use crate::inventory::atp_promise::refresh_sale_order_promise_dates;
use crate::inventory::barcode::barcode_scan;
use crate::inventory::product::{
    create_product, create_product_supplier_info, product, update_product_pricing,
    CreateProductParams, CreateProductSupplierInfoParams, UpdateProductPricingParams,
};
use crate::inventory::warehouse_sync::{
    apply_warehouse_sync_intent, create_warehouse_sync_intent, warehouse_sync_intent,
    CreateWarehouseSyncIntentParams,
};
use crate::inventory::quality::{
    create_quality_check, fail_quality_check, quality_check, CreateQualityCheckParams,
};
use crate::inventory::replenishment::{
    create_replenishment_rule, execute_replenishment_rule, replenishment_rule,
    CreateReplenishmentRuleParams,
};
use crate::inventory::stock::{
    apply_validated_move_to_quants, assign_stock_picking, confirm_stock_picking, create_stock_move,
    create_stock_picking, create_stock_quant, increase_quant_at_location, reserve_quantity_at_location,
    reserve_stock_quant, resolve_warehouse_stock_location, stock_move, stock_picking, stock_quant,
    to_product_stock_qty, validate_stock_picking, CreateStockMoveParams, CreateStockPickingParams,
    CreateStockQuantParams, StockQuantReserveParams,
};
use crate::inventory::tracking::{
    create_stock_production_lot, create_stock_production_serial, stock_production_lot,
    stock_production_serial, CreateStockProductionLotParams, CreateStockProductionSerialParams,
};
use crate::inventory::warehouse::{
    create_stock_location, stock_location, update_warehouse, warehouse, CreateStockLocationParams,
    UpdateWarehouseParams,
};
use crate::inventory::warehouse_operations::{
    cartonization_result, complete_picking_wave, create_packaging_material, create_picking_wave,
    packaging_material, picking_wave, release_picking_wave, run_cartonization,
    update_warehouse_task_status, warehouse_task, CreatePackagingMaterialParams,
    CreatePickingWaveParams, RunCartonizationParams,
};
use crate::purchasing::procurement_advanced::{
    consignment_agreement, create_consignment_agreement, CreateConsignmentAgreementParams,
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

/// Inbound validate stamps move lot_id onto the destination quant.
pub fn test_inbound_validate_stamps_lot_id(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "lot", "LOT-IN")?;

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-IN-A".to_string(),
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
        .find(|l| {
            l.organization_id == org_id && l.name == "LOT-IN-A" && l.product_id == product_id
        })
        .map(|l| l.id)
        .ok_or("inbound lot missing")?;

    create_stock_location(
        ctx,
        org_id,
        CreateStockLocationParams {
            name: "Supplier Inbound".to_string(),
            usage: "supplier".to_string(),
            location_category: "supplier".to_string(),
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
            complete_name: Some("Supplier Inbound".to_string()),
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            comment: None,
            barcode: None,
            last_inventory_date: None,
            next_inventory_date: None,
            metadata: Some(r#"{"test":"inbound-lot"}"#.to_string()),
        },
    )?;
    let src_loc = ctx
        .db
        .stock_location()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "Supplier Inbound")
        .map(|l| l.id)
        .ok_or("supplier location missing")?;

    apply_validated_move_to_quants(
        ctx,
        org_id,
        company_id,
        product_id,
        src_loc,
        fixture.warehouse_id,
        5.0,
        true,
        10.0,
        Some(lot_id),
    )?;

    let stamped = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.location_id == fixture.warehouse_id
                && q.lot_id == Some(lot_id)
        })
        .ok_or("inbound quant missing lot_id stamp")?;
    if (stamped.quantity - 5.0).abs() > 1e-9 {
        return Err(format!("expected qty 5, got {}", stamped.quantity));
    }
    Ok(())
}

/// Outbound validate keeps move lot_id on the destination quant.
pub fn test_outbound_transfer_keeps_lot_id(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_tracked_product(ctx, &fixture, "lot", "LOT-OUT")?;

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-OUT-A".to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 8.0,
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
            l.organization_id == org_id && l.name == "LOT-OUT-A" && l.product_id == product_id
        })
        .map(|l| l.id)
        .ok_or("outbound lot missing")?;

    // Untracked quant at source should be ignored when move carries lot_id.
    create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        20.0,
        None,
    )?;
    create_quant(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        8.0,
        Some(lot_id),
    )?;

    create_stock_location(
        ctx,
        org_id,
        CreateStockLocationParams {
            name: "Transfer Dest".to_string(),
            usage: "internal".to_string(),
            location_category: "internal".to_string(),
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
            complete_name: Some("Transfer Dest".to_string()),
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            comment: None,
            barcode: None,
            last_inventory_date: None,
            next_inventory_date: None,
            metadata: Some(r#"{"test":"outbound-lot"}"#.to_string()),
        },
    )?;
    let dest_loc = ctx
        .db
        .stock_location()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "Transfer Dest")
        .map(|l| l.id)
        .ok_or("dest location missing")?;

    apply_validated_move_to_quants(
        ctx,
        org_id,
        company_id,
        product_id,
        fixture.warehouse_id,
        dest_loc,
        3.0,
        false,
        0.0,
        Some(lot_id),
    )?;

    let dest = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.location_id == dest_loc
                && q.lot_id == Some(lot_id)
        })
        .ok_or("dest quant missing lot_id stamp")?;
    if (dest.quantity - 3.0).abs() > 1e-9 {
        return Err(format!("expected dest qty 3, got {}", dest.quantity));
    }

    let remaining_lot = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.location_id == fixture.warehouse_id
                && q.lot_id == Some(lot_id)
        })
        .ok_or("lot-matched source quant missing after consume")?;
    if (remaining_lot.quantity - 5.0).abs() > 1e-9 {
        return Err(format!(
            "expected lot source qty 5 after consume, got {}",
            remaining_lot.quantity
        ));
    }

    let untracked = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.location_id == fixture.warehouse_id
                && q.lot_id.is_none()
        })
        .ok_or("untracked source quant should be untouched")?;
    if (untracked.quantity - 20.0).abs() > 1e-9 {
        return Err(format!(
            "expected untracked source qty 20, got {}",
            untracked.quantity
        ));
    }

    Ok(())
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

/// Move create + reserve convert sale/move UoM into product stock UoM.
pub fn test_uom_conversion_on_move_and_reserve(ctx: &ReducerContext) -> Result<(), String> {
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
    let unit_uom = product.uom_id;
    let category_id = ctx
        .db
        .uom()
        .id()
        .find(&unit_uom)
        .map(|u| u.category_id)
        .ok_or("unit uom")?;

    create_uom(
        ctx,
        org_id,
        CreateUomParams {
            category_id,
            name: "Box10".to_string(),
            symbol: "box10".to_string(),
            factor: 10.0,
            rounding: 0.0,
            times_bigger: 10.0,
            is_reference_unit: false,
            is_active: true,
            metadata: None,
        },
    )?;
    let box_uom = ctx
        .db
        .uom()
        .iter()
        .find(|u| u.organization_id == org_id && u.name == "Box10")
        .map(|u| u.id)
        .ok_or("box uom")?;

    create_uom_conversion(
        ctx,
        org_id,
        category_id,
        CreateUomConversionParams {
            from_uom_id: box_uom,
            to_uom_id: unit_uom,
            factor: 10.0,
            product_id: Some(fixture.product_id),
            is_active: true,
            metadata: None,
        },
    )?;

    let stock_qty = to_product_stock_qty(ctx, org_id, fixture.product_id, box_uom, 2.0)?;
    if (stock_qty - 20.0).abs() > 0.001 {
        return Err(format!("expected 2 boxes → 20 units, got {stock_qty}"));
    }

    create_quant_for_fixture(ctx, &fixture, 20.0)?;
    reserve_quantity_at_location(
        ctx,
        org_id,
        company_id,
        fixture.product_id,
        fixture.warehouse_id,
        stock_qty,
    )?;

    create_stock_move(
        ctx,
        org_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: "Box move".to_string(),
            product_id: fixture.product_id,
            product_tmpl_id: fixture.product_id,
            product_uom: box_uom,
            product_uom_qty: 1.0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            date_expected: ctx.timestamp,
            move_type: "outgoing".to_string(),
            priority: "1".to_string(),
            reference: None,
            sequence: 10,
            origin: None,
            note: None,
            date: None,
            date_deadline: None,
            picking_id: None,
            picking_type_id: None,
            partner_id: Some(fixture.partner_id),
            product_variant_id: None,
            group_id: None,
            rule_id: None,
            procure_method: "make_to_stock".to_string(),
            price_unit: 0.0,
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
    let mv = ctx
        .db
        .stock_move()
        .iter()
        .find(|m| m.organization_id == org_id && m.name.as_deref() == Some("Box move"))
        .ok_or("move missing")?;
    if (mv.product_qty - 10.0).abs() > 0.001 {
        return Err(format!(
            "expected product_qty 10 for 1 box, got {}",
            mv.product_qty
        ));
    }
    Ok(())
}

/// Closed inventory period locks ATP reserve until reopened.
pub fn test_inventory_close_locks_stock(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    create_quant_for_fixture(ctx, &fixture, 5.0)?;

    create_inventory_close(
        ctx,
        org_id,
        company_id,
        CreateInventoryCloseParams {
            name: "IC-2026-07".to_string(),
            as_of: Some(ctx.timestamp),
            journal_id: None,
            inventory_account_id: None,
            valuation_account_id: None,
            metadata: None,
        },
    )?;
    let close_id = ctx
        .db
        .inventory_close()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "IC-2026-07")
        .map(|c| c.id)
        .ok_or("close missing")?;

    run_inventory_close(
        ctx,
        org_id,
        company_id,
        close_id,
        RunInventoryCloseParams {
            journal_id: None,
            inventory_account_id: None,
            valuation_account_id: None,
            metadata: None,
        },
    )?;

    match reserve_quantity_at_location(
        ctx,
        org_id,
        company_id,
        fixture.product_id,
        fixture.warehouse_id,
        1.0,
    ) {
        Err(msg) if msg.to_lowercase().contains("locked") => {}
        Err(msg) => return Err(format!("Expected locked error, got: {msg}")),
        Ok(()) => return Err("reserve should fail while inventory close is locked".into()),
    }

    reopen_inventory_close(ctx, org_id, company_id, close_id)?;
    reserve_quantity_at_location(
        ctx,
        org_id,
        company_id,
        fixture.product_id,
        fixture.warehouse_id,
        1.0,
    )?;
    Ok(())
}

/// 3PL ASN inbound intent posts stock on successful result.
pub fn test_3pl_asn_inbound_posts_stock(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_inventory_integration_intent(
        ctx,
        org_id,
        company_id,
        CreateInventoryIntegrationIntentParams {
            provider: "demo-3pl".to_string(),
            intent_type: "asn_inbound".to_string(),
            warehouse_id: Some(fixture.warehouse_id),
            picking_id: None,
            idempotency_key: format!("asn-{}", fixture.product_id),
            request_payload: Some(r#"{"asn":"A1"}"#.to_string()),
            metadata: None,
        },
    )?;
    let intent_id = ctx
        .db
        .inventory_integration_intent()
        .iter()
        .find(|i| {
            i.organization_id == org_id && i.idempotency_key == format!("asn-{}", fixture.product_id)
        })
        .map(|i| i.id)
        .ok_or("intent missing")?;

    record_inventory_integration_result(
        ctx,
        org_id,
        company_id,
        intent_id,
        RecordInventoryIntegrationResultParams {
            status: "succeeded".to_string(),
            external_reference: Some("EXT-ASN-1".to_string()),
            last_error: None,
            product_id: Some(fixture.product_id),
            location_id: Some(fixture.warehouse_id),
            quantity: Some(7.0),
            cost: Some(3.5),
            metadata: None,
        },
    )?;

    let quant = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == org_id
                && q.product_id == fixture.product_id
                && q.location_id == fixture.warehouse_id
        })
        .ok_or("quant after ASN")?;
    if (quant.quantity - 7.0).abs() > 0.001 {
        return Err(format!("expected qty 7 after ASN, got {}", quant.quantity));
    }
    Ok(())
}

/// Cartonization packs open moves into packaging materials (FFD).
pub fn test_cartonization_packs_moves(ctx: &ReducerContext) -> Result<(), String> {
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

    create_packaging_material(
        ctx,
        org_id,
        company_id,
        CreatePackagingMaterialParams {
            name: "Carton-S".to_string(),
            material_type: "box".to_string(),
            weight: 0.2,
            max_weight: 50.0,
            length: 40.0,
            width: 30.0,
            height: 20.0,
            volume: 100.0,
            cost: 1.0,
            currency_id: 1,
            barcode: None,
            is_active: true,
            metadata: None,
        },
    )?;

    create_stock_picking(
        ctx,
        org_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: "OUT-CARTON".to_string(),
            picking_type_id: 0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(fixture.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some("carton-test".to_string()),
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
            product_id: Some(fixture.product_id),
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
            metadata: None,
        },
    )?;
    let picking_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "OUT-CARTON")
        .map(|p| p.id)
        .ok_or("picking")?;

    create_stock_move(
        ctx,
        org_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: "Carton move".to_string(),
            product_id: fixture.product_id,
            product_tmpl_id: fixture.product_id,
            product_uom: product.uom_id,
            product_uom_qty: 2.0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            date_expected: ctx.timestamp,
            move_type: "outgoing".to_string(),
            priority: "1".to_string(),
            reference: None,
            sequence: 10,
            origin: None,
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
            price_unit: 0.0,
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

    run_cartonization(
        ctx,
        org_id,
        company_id,
        RunCartonizationParams {
            picking_id,
            packaging_material_id: None,
            metadata: None,
        },
    )?;

    let result = ctx
        .db
        .cartonization_result()
        .iter()
        .find(|r| r.organization_id == org_id && r.total_items >= 1)
        .ok_or("cartonization result missing")?;
    let mv = ctx
        .db
        .stock_move()
        .iter()
        .find(|m| m.organization_id == org_id && m.picking_id == Some(picking_id))
        .ok_or("move")?;
    if mv.result_package_id != Some(result.package_id) {
        return Err(format!(
            "expected move result_package_id {:?}, got {:?}",
            result.package_id, mv.result_package_id
        ));
    }
    Ok(())
}

/// Vendor-consigned stock is excluded from company ATP reserve.
pub fn test_consignment_excluded_from_atp(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let wh = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("warehouse")?;

    create_consignment_agreement(
        ctx,
        org_id,
        company_id,
        CreateConsignmentAgreementParams {
            name: "CONS-1".to_string(),
            partner_id: fixture.partner_id,
            product_id: fixture.product_id,
            warehouse_id: fixture.warehouse_id,
            metadata: None,
        },
    )?;
    let agreement_id = ctx
        .db
        .consignment_agreement()
        .iter()
        .find(|a| a.organization_id == org_id && a.name == "CONS-1")
        .map(|a| a.id)
        .ok_or("agreement")?;

    activate_consignment_agreement(ctx, org_id, company_id, agreement_id)?;
    receive_consignment_stock(
        ctx,
        org_id,
        company_id,
        ReceiveConsignmentStockParams {
            agreement_id,
            location_id: Some(wh.lot_stock_id),
            quantity: 12.0,
            cost: 5.0,
            lot_id: None,
            metadata: None,
        },
    )?;

    let consigned = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == org_id
                && q.product_id == fixture.product_id
                && q.owner_id == Some(fixture.partner_id)
        })
        .ok_or("consigned quant")?;
    if consigned.available_quantity > 0.001 {
        return Err("consigned stock must not be ATP-available".into());
    }

    match reserve_quantity_at_location(
        ctx,
        org_id,
        company_id,
        fixture.product_id,
        wh.lot_stock_id,
        1.0,
    ) {
        Err(msg)
            if msg.to_lowercase().contains("no stock")
                || msg.to_lowercase().contains("cannot reserve")
                || msg.to_lowercase().contains("insufficient") =>
        {
            Ok(())
        }
        Err(msg) => Err(format!("Expected ATP fail on consigned-only stock, got: {msg}")),
        Ok(()) => {
            // Harness also seeds company-owned qty at lot_stock — reserve may succeed on that.
            // Ensure consigned quant reserved stayed 0.
            let c = ctx
                .db
                .stock_quant()
                .id()
                .find(&consigned.id)
                .ok_or("consigned after")?;
            if c.reserved_quantity > 0.001 {
                Err("must not reserve against consigned owner_id quant".into())
            } else {
                Ok(())
            }
        }
    }
}

/// Cross-dock creates outbound picking from inbound dest when warehouse.crossdock.
pub fn test_cross_dock_creates_outbound(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    update_warehouse(
        ctx,
        org_id,
        company_id,
        fixture.warehouse_id,
        UpdateWarehouseParams {
            name: None,
            code: None,
            active: None,
            reception_steps: None,
            delivery_steps: None,
            manufacture_steps: None,
            buy_to_resupply: None,
            manufacture_to_resupply: None,
            crossdock: Some(true),
            sequence: None,
            partner_id: None,
            resupply_wh_ids: None,
            metadata: None,
        },
    )?;

    create_quant(
        ctx,
        org_id,
        company_id,
        fixture.product_id,
        fixture.warehouse_id,
        8.0,
        None,
    )?;

    create_stock_picking(
        ctx,
        org_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: "IN-XDOCK".to_string(),
            picking_type_id: 0,
            location_id: fixture.partner_id,
            location_dest_id: fixture.warehouse_id,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(fixture.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some("xdock-in".to_string()),
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
            product_id: Some(fixture.product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("incoming".to_string()),
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
            metadata: None,
        },
    )?;
    let inbound_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "IN-XDOCK")
        .map(|p| p.id)
        .ok_or("inbound")?;

    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };
    confirm_stock_picking(ctx, org_id, inbound_id, scope.clone())?;
    assign_stock_picking(ctx, org_id, inbound_id, scope)?;

    execute_cross_dock(
        ctx,
        org_id,
        company_id,
        ExecuteCrossDockParams {
            inbound_picking_id: inbound_id,
            product_id: fixture.product_id,
            quantity: 3.0,
            partner_id: fixture.partner_id,
            location_dest_id: Some(fixture.partner_id),
            metadata: None,
        },
    )?;

    let outbound = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| {
            p.organization_id == org_id && p.name == format!("XD-{inbound_id}")
        })
        .ok_or("cross-dock outbound missing")?;
    if outbound.location_id != fixture.warehouse_id {
        return Err(format!(
            "expected outbound source at inbound dest, got {}",
            outbound.location_id
        ));
    }
    Ok(())
}

/// Directed putaway moves available stock to an explicit bin and records a putaway task.
pub fn test_directed_putaway_moves_stock(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let wh = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("warehouse")?;

    create_stock_location(
        ctx,
        org_id,
        CreateStockLocationParams {
            name: "Input Stage".to_string(),
            usage: "internal".to_string(),
            location_category: "input".to_string(),
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
            location_id: Some(wh.lot_stock_id),
            complete_name: Some("Input Stage".to_string()),
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            comment: None,
            barcode: None,
            last_inventory_date: None,
            next_inventory_date: None,
            metadata: None,
        },
    )?;
    create_stock_location(
        ctx,
        org_id,
        CreateStockLocationParams {
            name: "Bin-A1".to_string(),
            usage: "internal".to_string(),
            location_category: "bin".to_string(),
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
            location_id: Some(wh.lot_stock_id),
            complete_name: Some("Bin-A1".to_string()),
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            comment: None,
            barcode: None,
            last_inventory_date: None,
            next_inventory_date: None,
            metadata: None,
        },
    )?;
    let input_id = ctx
        .db
        .stock_location()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "Input Stage")
        .map(|l| l.id)
        .ok_or("input loc")?;
    let bin_id = ctx
        .db
        .stock_location()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "Bin-A1")
        .map(|l| l.id)
        .ok_or("bin loc")?;

    create_quant(
        ctx,
        org_id,
        company_id,
        fixture.product_id,
        input_id,
        12.0,
        None,
    )?;

    execute_directed_putaway(
        ctx,
        org_id,
        company_id,
        ExecuteDirectedPutawayParams {
            warehouse_id: fixture.warehouse_id,
            product_id: fixture.product_id,
            source_location_id: input_id,
            quantity: 5.0,
            dest_location_id: Some(bin_id),
            strategy: "fixed".to_string(),
            metadata: None,
        },
    )?;

    let at_bin = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == bin_id
                && q.owner_id.is_none()
        })
        .ok_or("quant missing at bin")?;
    if (at_bin.quantity - 5.0).abs() > 0.001 {
        return Err(format!("expected 5 at bin, got {}", at_bin.quantity));
    }

    let task = ctx
        .db
        .warehouse_task()
        .iter()
        .find(|t| {
            t.organization_id == org_id
                && t.task_type == "putaway"
                && t.location_dest_id == Some(bin_id)
        })
        .ok_or("putaway task missing")?;
    if task.state != "done" {
        return Err(format!("expected putaway task done, got {}", task.state));
    }
    Ok(())
}

/// Inventory close with GL accounts posts a balanced valuation Entry.
pub fn test_inventory_close_posts_valuation_journal(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("company")?
        .currency_id;

    let asset_type_name = format!("Inv Asset Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: asset_type_name.clone(),
            type_: "asset".into(),
            include_initial_balance: false,
            internal_group: AccountInternalGroup::Asset,
            metadata: None,
        },
    )?;
    let asset_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == asset_type_name)
        .map(|t| t.id)
        .ok_or("asset type")?;

    let inv_code = format!("1INV{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: inv_code.clone(),
            name: "Inventory Asset".into(),
            user_type_id: asset_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Asset),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let inv_acct = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == inv_code)
        .map(|a| a.id)
        .ok_or("inventory account")?;

    let val_code = format!("1VAL{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: val_code.clone(),
            name: "Inventory Valuation".into(),
            user_type_id: asset_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Asset),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let val_acct = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == val_code)
        .map(|a| a.id)
        .ok_or("valuation account")?;

    let journal_code = format!("STK{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: "Stock Valuation".into(),
            code: journal_code.clone(),
            type_: JournalType::Inventory,
            currency_id: Some(currency_id),
            default_account_id: Some(inv_acct),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: None,
            payment_credit_account_id: None,
            payment_debit_account_id: None,
            invoice_reference_type: None,
            invoice_reference_model: None,
            sequence_id: None,
            refund_sequence_id: None,
            sequence_override_regex: None,
            secure_sequence_id: None,
            alias_name: None,
            alias_domain: None,
            sale_activity_type_id: None,
            sale_activity_user_id: None,
            sale_activity_note: None,
            sale_activity_date_deadline: None,
            restrict_mode_hash_table: false,
            active: true,
            at_least_one_inbound: true,
            at_least_one_outbound: true,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: None,
        },
    )?;
    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
        .map(|j| j.id)
        .ok_or("stock journal")?;

    create_inventory_close(
        ctx,
        org_id,
        company_id,
        CreateInventoryCloseParams {
            name: "IC-VAL-2026".to_string(),
            as_of: Some(ctx.timestamp),
            journal_id: Some(journal_id),
            inventory_account_id: Some(inv_acct),
            valuation_account_id: Some(val_acct),
            metadata: None,
        },
    )?;
    let close_id = ctx
        .db
        .inventory_close()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "IC-VAL-2026")
        .map(|c| c.id)
        .ok_or("close missing")?;

    run_inventory_close(
        ctx,
        org_id,
        company_id,
        close_id,
        RunInventoryCloseParams {
            journal_id: None,
            inventory_account_id: None,
            valuation_account_id: None,
            metadata: None,
        },
    )?;

    let close = ctx
        .db
        .inventory_close()
        .id()
        .find(&close_id)
        .ok_or("close after run")?;
    let move_id = close.account_move_id.ok_or("account_move_id missing")?;
    if close.total_value <= 0.0 {
        return Err("expected positive total_value from harness quant".into());
    }

    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("valuation move missing")?;
    if mv.company_id != company_id {
        return Err("move company mismatch".into());
    }
    if mv.currency_id != currency_id || mv.company_currency_id != currency_id {
        return Err("valuation move did not use the company currency".into());
    }

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == move_id)
        .collect();
    if lines.len() != 2 {
        return Err(format!("expected 2 valuation lines, got {}", lines.len()));
    }
    if lines
        .iter()
        .any(|line| line.currency_id != currency_id || line.company_currency_id != currency_id)
    {
        return Err("valuation lines did not use the company currency".into());
    }
    let debit: f64 = lines.iter().map(|l| l.debit).sum();
    let credit: f64 = lines.iter().map(|l| l.credit).sum();
    if (debit - credit).abs() > 0.001 || (debit - close.total_value).abs() > 0.001 {
        return Err(format!(
            "unbalanced or wrong amount: debit={debit} credit={credit} value={}",
            close.total_value
        ));
    }
    Ok(())
}

/// Packing workflow: pack picking → confirmed package with result_package_id → done.
pub fn test_packing_workflow(ctx: &ReducerContext) -> Result<(), String> {
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

    create_packaging_material(
        ctx,
        org_id,
        company_id,
        CreatePackagingMaterialParams {
            name: "Ship Box".to_string(),
            material_type: "box".to_string(),
            weight: 0.2,
            max_weight: 50.0,
            length: 40.0,
            width: 30.0,
            height: 20.0,
            volume: 100.0,
            cost: 1.0,
            currency_id: 1,
            barcode: None,
            is_active: true,
            metadata: None,
        },
    )?;
    let material_id = ctx
        .db
        .packaging_material()
        .iter()
        .find(|m| m.organization_id == org_id && m.name == "Ship Box")
        .map(|m| m.id)
        .ok_or("material")?;

    create_stock_picking(
        ctx,
        org_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: "OUT-PACK".to_string(),
            picking_type_id: 0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(fixture.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some("pack-test".to_string()),
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
            product_id: Some(fixture.product_id),
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
            metadata: None,
        },
    )?;
    let picking_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "OUT-PACK")
        .map(|p| p.id)
        .ok_or("picking")?;

    create_stock_move(
        ctx,
        org_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: "Pack move".to_string(),
            product_id: fixture.product_id,
            product_tmpl_id: fixture.product_id,
            product_uom: product.uom_id,
            product_uom_qty: 3.0,
            location_id: fixture.warehouse_id,
            location_dest_id: fixture.partner_id,
            date_expected: ctx.timestamp,
            move_type: "outgoing".to_string(),
            priority: "1".to_string(),
            reference: None,
            sequence: 10,
            origin: None,
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
            price_unit: 0.0,
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

    pack_stock_picking(
        ctx,
        org_id,
        company_id,
        PackStockPickingParams {
            picking_id,
            packaging_material_id: Some(material_id),
            name: Some("PACK-TEST".to_string()),
            metadata: None,
        },
    )?;

    let pkg = ctx
        .db
        .stock_package()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "PACK-TEST")
        .ok_or("package missing")?;
    if pkg.state != "confirmed" {
        return Err(format!("expected confirmed, got {}", pkg.state));
    }
    if pkg.move_ids.is_empty() {
        return Err("package has no moves".into());
    }

    let mv = ctx
        .db
        .stock_move()
        .id()
        .find(&pkg.move_ids[0])
        .ok_or("move")?;
    if mv.result_package_id != Some(pkg.id) {
        return Err("move result_package_id not stamped".into());
    }

    done_stock_package(ctx, org_id, company_id, pkg.id)?;
    let done = ctx
        .db
        .stock_package()
        .id()
        .find(&pkg.id)
        .ok_or("package after done")?;
    if done.state != "done" {
        return Err(format!("expected done, got {}", done.state));
    }
    Ok(())
}

/// Exception queues: short ATP, expired lot, and open QC after refresh / fail.
pub fn test_inventory_exception_queues(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let quant_id = create_quant(
        ctx,
        org_id,
        company_id,
        fixture.product_id,
        fixture.warehouse_id,
        4.0,
        None,
    )?;
    reserve_stock_quant(
        ctx,
        org_id,
        quant_id,
        StockQuantReserveParams {
            company_id: Some(company_id),
            reserve_qty: 4.0,
        },
    )?;

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: format!("LOT-EXP-{company_id}"),
            product_id: fixture.product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: Some(past_timestamp(ctx)),
            use_date: None,
            removal_date: Some(past_timestamp(ctx)),
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

    refresh_inventory_exceptions(
        ctx,
        org_id,
        company_id,
        RefreshInventoryExceptionsParams {
            upsert_only: false,
            metadata: None,
        },
    )?;

    let short = ctx
        .db
        .inventory_exception()
        .iter()
        .find(|e| {
            e.organization_id == org_id
                && e.company_id == company_id
                && e.exception_type == "short_atp"
                && e.state == "open"
                && e.quant_id == Some(quant_id)
        })
        .ok_or("short_atp exception missing")?;

    let expired = ctx
        .db
        .inventory_exception()
        .iter()
        .find(|e| {
            e.organization_id == org_id
                && e.company_id == company_id
                && e.exception_type == "expired_lot"
                && e.state == "open"
        })
        .ok_or("expired_lot exception missing")?;

    create_quant_for_fixture(ctx, &fixture, 5.0)?;
    create_stock_location(
        ctx,
        org_id,
        CreateStockLocationParams {
            name: "QC Exc".to_string(),
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
            complete_name: Some("QC Exc".to_string()),
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            comment: None,
            barcode: None,
            last_inventory_date: None,
            next_inventory_date: None,
            metadata: None,
        },
    )?;
    let qc_loc = ctx
        .db
        .stock_location()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "QC Exc")
        .map(|l| l.id)
        .ok_or("qc loc")?;

    create_quality_check(
        ctx,
        org_id,
        company_id,
        CreateQualityCheckParams {
            name: "QC-EXC".to_string(),
            test_type: "passfail".to_string(),
            product_id: Some(fixture.product_id),
            product_variant_id: None,
            picking_id: None,
            move_line_id: None,
            lot_id: None,
            team_id: None,
            user_id: None,
            control_point_id: None,
            qty_tested: 5.0,
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
        .find(|c| c.organization_id == org_id && c.name == "QC-EXC")
        .map(|c| c.id)
        .ok_or("qc check")?;

    fail_quality_check(
        ctx,
        org_id,
        company_id,
        check_id,
        1.0,
        None,
        None,
        Some(qc_loc),
    )?;

    let open_qc = ctx
        .db
        .inventory_exception()
        .iter()
        .find(|e| {
            e.organization_id == org_id
                && e.exception_type == "open_qc"
                && e.state == "open"
                && e.quality_check_id == Some(check_id)
        })
        .ok_or("open_qc exception missing")?;

    resolve_inventory_exception(ctx, org_id, company_id, short.id)?;
    let short_after = ctx
        .db
        .inventory_exception()
        .id()
        .find(&short.id)
        .ok_or("short after")?;
    if short_after.state != "resolved" {
        return Err("short_atp should resolve manually".into());
    }

    if expired.state != "open" || open_qc.state != "open" {
        return Err("expired_lot and open_qc should remain open".into());
    }
    Ok(())
}

/// Average costing: two inbound increases at different unit costs blend into one quant.
pub fn test_receipt_average_costing(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let stock_loc = resolve_warehouse_stock_location(ctx, fixture.warehouse_id);

    update_product_pricing(
        ctx,
        org_id,
        fixture.product_id,
        UpdateProductPricingParams {
            standard_price: None,
            list_price: None,
            currency_id: None,
            cost_method: Some("average".to_string()),
        },
    )?;

    // Clear harness quant so we start clean.
    for q in ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == stock_loc
        })
        .collect::<Vec<_>>()
    {
        ctx.db.stock_quant().id().delete(&q.id);
    }

    increase_quant_at_location(ctx, org_id, company_id, fixture.product_id, stock_loc, 10.0, 5.0)?;
    increase_quant_at_location(ctx, org_id, company_id, fixture.product_id, stock_loc, 10.0, 15.0)?;

    let quants: Vec<_> = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == stock_loc
        })
        .collect();
    if quants.len() != 1 {
        return Err(format!("average should merge to 1 quant, got {}", quants.len()));
    }
    let q = &quants[0];
    if (q.quantity - 20.0).abs() > 1e-6 {
        return Err(format!("expected qty 20, got {}", q.quantity));
    }
    // (10*5 + 10*15) / 20 = 10
    if (q.cost - 10.0).abs() > 1e-6 {
        return Err(format!("expected blended cost 10, got {}", q.cost));
    }
    if q.cost_method.as_deref() != Some("average") {
        return Err(format!("expected cost_method average, got {:?}", q.cost_method));
    }
    Ok(())
}

/// FIFO costing: different unit costs create separate layers at the same location.
pub fn test_receipt_fifo_layers(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let stock_loc = resolve_warehouse_stock_location(ctx, fixture.warehouse_id);

    update_product_pricing(
        ctx,
        org_id,
        fixture.product_id,
        UpdateProductPricingParams {
            standard_price: None,
            list_price: None,
            currency_id: None,
            cost_method: Some("fifo".to_string()),
        },
    )?;

    for q in ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == stock_loc
        })
        .collect::<Vec<_>>()
    {
        ctx.db.stock_quant().id().delete(&q.id);
    }

    increase_quant_at_location(ctx, org_id, company_id, fixture.product_id, stock_loc, 4.0, 8.0)?;
    increase_quant_at_location(ctx, org_id, company_id, fixture.product_id, stock_loc, 6.0, 12.0)?;

    let quants: Vec<_> = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == stock_loc
        })
        .collect();
    if quants.len() != 2 {
        return Err(format!("fifo should keep 2 layers, got {}", quants.len()));
    }
    let mut costs: Vec<f64> = quants.iter().map(|q| q.cost).collect();
    costs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if (costs[0] - 8.0).abs() > 1e-6 || (costs[1] - 12.0).abs() > 1e-6 {
        return Err(format!("expected layer costs 8 and 12, got {:?}", costs));
    }
    Ok(())
}

/// Warehouse sync: idempotent create, apply barcode once, second apply no-ops, bad apply → failed.
pub fn test_warehouse_sync_intent(ctx: &ReducerContext) -> Result<(), String> {
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
    ctx.db.product().id().update(crate::inventory::product::Product {
        barcode: Some("SYNC-BC-001".to_string()),
        ..product
    });

    let key = format!("sync-{}-1", org_id);
    let payload = serde_json::json!({
        "barcode": "SYNC-BC-001",
        "barcode_type": "ean13",
        "device_id": "dev-1",
        "quantity": 1.0,
    })
    .to_string();

    create_warehouse_sync_intent(
        ctx,
        org_id,
        company_id,
        CreateWarehouseSyncIntentParams {
            warehouse_id: fixture.warehouse_id,
            op_type: "barcode_scan".to_string(),
            idempotency_key: key.clone(),
            device_id: Some("dev-1".to_string()),
            payload: payload.clone(),
            metadata: None,
        },
    )?;
    create_warehouse_sync_intent(
        ctx,
        org_id,
        company_id,
        CreateWarehouseSyncIntentParams {
            warehouse_id: fixture.warehouse_id,
            op_type: "barcode_scan".to_string(),
            idempotency_key: key.clone(),
            device_id: Some("dev-1".to_string()),
            payload: payload.clone(),
            metadata: None,
        },
    )?;

    let count = ctx
        .db
        .warehouse_sync_intent()
        .iter()
        .filter(|i| i.organization_id == org_id && i.idempotency_key == key)
        .count();
    if count != 1 {
        return Err(format!("expected 1 intent for key, got {count}"));
    }
    let intent_id = ctx
        .db
        .warehouse_sync_intent()
        .iter()
        .find(|i| i.organization_id == org_id && i.idempotency_key == key)
        .map(|i| i.id)
        .ok_or("intent")?;

    apply_warehouse_sync_intent(ctx, org_id, company_id, intent_id)?;
    apply_warehouse_sync_intent(ctx, org_id, company_id, intent_id)?;

    let applied = ctx
        .db
        .warehouse_sync_intent()
        .id()
        .find(&intent_id)
        .ok_or("intent after apply")?;
    if applied.status != "applied" {
        return Err(format!("expected applied, got {}", applied.status));
    }
    let scans = ctx
        .db
        .barcode_scan()
        .iter()
        .filter(|s| s.organization_id == org_id && s.barcode == "SYNC-BC-001")
        .count();
    if scans != 1 {
        return Err(format!("expected 1 barcode scan, got {scans}"));
    }

    let fail_key = format!("sync-{}-fail", org_id);
    create_warehouse_sync_intent(
        ctx,
        org_id,
        company_id,
        CreateWarehouseSyncIntentParams {
            warehouse_id: fixture.warehouse_id,
            op_type: "cycle_count_line".to_string(),
            idempotency_key: fail_key.clone(),
            device_id: Some("dev-1".to_string()),
            payload: serde_json::json!({
                "cycle_count_id": 999999u64,
                "product_id": fixture.product_id,
                "location_id": fixture.warehouse_id,
                "qty_counted": 1.0,
                "uom_id": 1u64,
            })
            .to_string(),
            metadata: None,
        },
    )?;
    let fail_id = ctx
        .db
        .warehouse_sync_intent()
        .iter()
        .find(|i| i.organization_id == org_id && i.idempotency_key == fail_key)
        .map(|i| i.id)
        .ok_or("fail intent")?;
    apply_warehouse_sync_intent(ctx, org_id, company_id, fail_id)?;
    let failed = ctx
        .db
        .warehouse_sync_intent()
        .id()
        .find(&fail_id)
        .ok_or("fail after")?;
    if failed.status != "failed" {
        return Err(format!("expected failed status, got {}", failed.status));
    }
    Ok(())
}

/// Multi-WH promise: stock only on resupply WH → promise + confirm reserves there.
pub fn test_multi_wh_promise_atp(ctx: &ReducerContext) -> Result<(), String> {
    use crate::inventory::warehouse::{Warehouse, StockLocation};
    use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
    use crate::sales::sales_core::{
        confirm_sales_order, create_sale_order, sale_order, sale_order_line,
        CreateSaleOrderLineParams, CreateSaleOrderParams,
    };
    use crate::types::DiscountPolicy;

    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let primary_loc = resolve_warehouse_stock_location(ctx, fixture.warehouse_id);

    // Drain primary ATP
    for q in ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == primary_loc
        })
        .collect::<Vec<_>>()
    {
        ctx.db.stock_quant().id().delete(&q.id);
    }

    // Secondary warehouse with stock
    let wh_b = ctx.db.warehouse().insert(Warehouse {
        id: 0,
        organization_id: org_id,
        name: "Resupply WH B".to_string(),
        code: "WHB".to_string(),
        active: true,
        company_id,
        partner_id: Some(fixture.partner_id),
        lot_stock_id: 0,
        wh_input_stock_loc_id: None,
        wh_pack_stock_loc_id: None,
        wh_output_stock_loc_id: None,
        wh_qc_stock_loc_id: None,
        wh_scrap_loc_id: None,
        in_type_id: 0,
        out_type_id: 0,
        int_type_id: 0,
        pack_type_id: 0,
        pick_type_id: 0,
        qc_type_id: None,
        return_type_id: None,
        crossdock: false,
        reception_steps: "one_step".to_string(),
        delivery_steps: "one_step".to_string(),
        resupply_wh_ids: vec![],
        resupply_from_ids: vec![],
        buy_to_resupply: true,
        manufacture_to_resupply: false,
        manufacture_steps: "mrp_one_step".to_string(),
        resupply_subcontractor_on_order: false,
        subcontracting_to_resupply: false,
        view_location_id: None,
        mto_pull_id: None,
        buy_pull_id: None,
        pbh_dpm_ids: vec![],
        sequence: 2,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: Some(r#"{"test":"multi_wh"}"#.to_string()),
    });
    let loc_b = ctx.db.stock_location().insert(StockLocation {
        id: 0,
        organization_id: org_id,
        name: "Stock B".to_string(),
        complete_name: Some("WHB/Stock".to_string()),
        location_id: None,
        parent_path: "".to_string(),
        child_ids: vec![],
        child_left: 0,
        child_right: 0,
        usage: "internal".to_string(),
        company_id: Some(company_id),
        scrap_location: false,
        return_location: false,
        valuation_in_account_id: None,
        valuation_out_account_id: None,
        active: true,
        comment: None,
        posx: 0.0,
        posy: 0.0,
        posz: 0.0,
        barcode: None,
        cyclic_inventory_frequency: 0,
        last_inventory_date: None,
        next_inventory_date: None,
        location_category: "internal".to_string(),
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });
    ctx.db.warehouse().id().update(Warehouse {
        lot_stock_id: loc_b.id,
        ..wh_b
    });

    create_quant(ctx, org_id, company_id, fixture.product_id, loc_b.id, 20.0, None)?;

    update_warehouse(
        ctx,
        org_id,
        company_id,
        fixture.warehouse_id,
        UpdateWarehouseParams {
            name: None,
            code: None,
            active: None,
            reception_steps: None,
            delivery_steps: None,
            manufacture_steps: None,
            buy_to_resupply: None,
            manufacture_to_resupply: None,
            crossdock: None,
            sequence: None,
            partner_id: None,
            resupply_wh_ids: Some(vec![wh_b.id]),
            metadata: None,
        },
    )?;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: "MultiWH PL".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "MultiWH PL")
        .map(|p| p.id)
        .ok_or("pricelist")?;

    create_sale_order(
        ctx,
        org_id,
        CreateSaleOrderParams {
            company_id: Some(company_id),
            partner_id: fixture.partner_id,
            partner_invoice_id: fixture.partner_id,
            partner_shipping_id: fixture.partner_id,
            pricelist_id,
            currency_id: 1,
            warehouse_id: fixture.warehouse_id,
            order_lines: vec![CreateSaleOrderLineParams {
                product_id: fixture.product_id,
                quantity: 5.0,
                uom_id: product.uom_id,
                price_unit: Some(product.list_price),
                discount: 0.0,
                tax_ids: vec![],
                name: None,
                sequence: 1,
                is_downpayment: false,
                display_type: None,
                product_variant_id: None,
                packaging_id: None,
                route_id: None,
                analytic_tag_ids: vec![],
                customer_lead: Some(2.0),
                metadata: None,
            }],
            origin: Some("MultiWH SO".to_string()),
            client_order_ref: Some("MWH-001".to_string()),
            payment_term_id: None,
            fiscal_position_id: None,
            team_id: None,
            opportunity_id: None,
            proposal_id: None,
            note: None,
            terms_and_conditions: None,
            validity_days: None,
            shipping_policy: None,
            picking_policy: None,
            campaign_id: None,
            medium_id: None,
            source_id: None,
            commitment_date: None,
            expected_date: None,
            incoterm_id: None,
            incoterm: None,
            incoterm_location: None,
            carrier_id: None,
            customer_lead: Some(2.0),
            analytic_account_id: None,
            user_id: None,
            is_printed: None,
            is_locked: None,
            is_dropship: None,
            invoice_policy: None,
            message_follower_ids: None,
            message_partner_ids: None,
            message_channel_ids: None,
            activity_ids: None,
            metadata: Some(r#"{"test":"multi_wh"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref == Some("MWH-001".to_string())
        })
        .ok_or("SO missing")?;

    refresh_sale_order_promise_dates(ctx, org_id, company_id, order.id)?;

    let line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("line")?;
    if line.free_qty_today < 5.0 {
        return Err(format!(
            "expected free_qty_today >= 5 from WH-B, got {}",
            line.free_qty_today
        ));
    }
    if line.scheduled_date.is_none() {
        return Err("scheduled_date should be set by promise refresh".into());
    }

    let order_after = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("order after promise")?;
    if order_after.commitment_date.is_none() {
        return Err("commitment_date should be set".into());
    }

    confirm_sales_order(ctx, org_id, company_id, order.id)?;

    let reserved_b: f64 = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == loc_b.id
        })
        .map(|q| q.reserved_quantity)
        .sum();
    if (reserved_b - 5.0).abs() > 1e-6 {
        return Err(format!("expected 5 reserved at WH-B, got {reserved_b}"));
    }

    let xfer = ctx.db.stock_picking().iter().any(|p| {
        p.organization_id == org_id
            && p.picking_code.as_deref() == Some("internal")
            && p.origin.as_deref() == Some(&format!("SO-ATP-{}", order.id))
    });
    if !xfer {
        return Err("expected draft INT ATP transfer demand".into());
    }
    Ok(())
}
