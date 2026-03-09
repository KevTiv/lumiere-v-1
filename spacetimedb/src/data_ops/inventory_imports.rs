/// Inventory CSV Imports — ProductCategory, Product, ProductVariant,
///                         Warehouse, StockLocation, StockQuant, StockProductionLot
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::inventory::product::{product, product_variant, Product, ProductVariant};
use crate::inventory::product_category::{product_category, ProductCategory};
use crate::inventory::stock::stock_quant;
use crate::inventory::stock::StockQuant;
use crate::inventory::tracking::{stock_production_lot, StockProductionLot};
use crate::inventory::warehouse::{stock_location, warehouse, StockLocation, Warehouse};

// ── ProductCategory ───────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_product_category_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_category", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "product_category",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let parent_id = opt_u64(col(&headers, row, "parent_id"));

        ctx.db.product_category().insert(ProductCategory {
            id: 0,
            name: name.clone(),
            parent_id,
            sequence: parse_u32(col(&headers, row, "sequence")),
            deleted_at: None,
            company_id: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import product_category: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── Product ───────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_product_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    currency_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "product", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let uom_id = parse_u64(col(&headers, row, "uom_id"));
        let list_price = parse_f64(col(&headers, row, "sale_price"));
        let standard_price = parse_f64(col(&headers, row, "cost_price"));
        let type_ = {
            let t = col(&headers, row, "type_field");
            match t {
                "service" => "service",
                "consumable" => "consu",
                _ => "product",
            }
            .to_string()
        };

        ctx.db.product().insert(Product {
            id: 0,
            organization_id,
            name: name.clone(),
            display_name: Some(name),
            code: opt_str(col(&headers, row, "internal_reference")),
            default_code: opt_str(col(&headers, row, "internal_reference")),
            barcode: opt_str(col(&headers, row, "barcode")),
            categ_id: parse_u64(col(&headers, row, "category_id")),
            type_,
            uom_id,
            uom_po_id: parse_u64(col(&headers, row, "uom_po_id")),
            description: opt_str(col(&headers, row, "description")),
            description_purchase: None,
            description_sale: None,
            cost_method: "standard".to_string(),
            valuation: "manual_periodic".to_string(),
            standard_price,
            volume: parse_f64(col(&headers, row, "volume")),
            weight: parse_f64(col(&headers, row, "weight")),
            sale_ok: parse_bool(col(&headers, row, "can_be_sold")),
            purchase_ok: parse_bool(col(&headers, row, "can_be_purchased")),
            can_be_expensed: false,
            available_in_pos: false,
            invoicing_policy: "order".to_string(),
            expense_policy: "no".to_string(),
            service_type: None,
            service_tracking: None,
            image_1920_url: None,
            image_128_url: None,
            color: None,
            priority: "normal".to_string(),
            is_published: false,
            active: parse_bool(col(&headers, row, "active")),
            responsible_id: None,
            seller_ids: vec![],
            variant_count: 0,
            variant_attribute_ids: vec![],
            attribute_line_ids: vec![],
            value_extra_price_ids: vec![],
            product_variant_count: 0,
            product_variant_ids: vec![],
            currency_id,
            public_price: list_price,
            list_price,
            lst_price: list_price,
            price: list_price,
            pricelist_id: None,
            taxes_id: vec![],
            supplier_taxes_id: vec![],
            route_from_categ_ids: vec![],
            route_ids: vec![],
            tracking: "none".to_string(),
            description_picking: None,
            description_pickingout: None,
            description_pickingin: None,
            qty_available: 0.0,
            virtual_available: 0.0,
            incoming_qty: 0.0,
            outgoing_qty: 0.0,
            location_id: None,
            warehouse_id: None,
            has_configurable_attributes: false,
            property_account_income_id: None,
            property_account_expense_id: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import product: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── ProductVariant ────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_product_variant_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_variant", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "product_variant",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let product_tmpl_id = parse_u64(col(&headers, row, "product_id"));

        if product_tmpl_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_id"),
                None,
                "product_id is required",
            );
            errors += 1;
            continue;
        }

        let name = if let Some(p) = ctx.db.product().id().find(&product_tmpl_id) {
            p.name
        } else {
            format!("Variant {}", product_tmpl_id)
        };

        let lst_price = parse_f64(col(&headers, row, "price_extra"));

        ctx.db.product_variant().insert(ProductVariant {
            id: 0,
            organization_id,
            product_tmpl_id,
            name: name.clone(),
            display_name: Some(name),
            default_code: opt_str(col(&headers, row, "internal_reference")),
            barcode: opt_str(col(&headers, row, "barcode")),
            combination_indices: None,
            is_product_variant: true,
            attribute_value_ids: vec_u64(col(&headers, row, "attribute_values")),
            volume: 0.0,
            weight: 0.0,
            standard_price: 0.0,
            lst_price,
            price: lst_price,
            price_extra: lst_price,
            qty_available: 0.0,
            virtual_available: 0.0,
            incoming_qty: 0.0,
            outgoing_qty: 0.0,
            orderpoint_ids: vec![],
            nbr_reordering_rules: 0,
            reordering_min_qty: 0.0,
            reordering_max_qty: 0.0,
            product_template_attribute_value_ids: vec![],
            combination_indices_dict: None,
            is_active: parse_bool(col(&headers, row, "active")),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import product_variant: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── Warehouse ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_warehouse_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "warehouse", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();
        let code = col(&headers, row, "code").to_string();

        if name.is_empty() || code.is_empty() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("name"),
                None,
                "name and code are required",
            );
            errors += 1;
            continue;
        }

        ctx.db.warehouse().insert(Warehouse {
            id: 0,
            organization_id,
            name,
            code,
            active: true,
            company_id,
            partner_id: None,
            // These reference stock locations / picking types created during warehouse setup.
            // For bulk import, set to 0; caller should update after import.
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
            sequence: 10,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import warehouse: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── StockLocation ─────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_stock_location_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_location", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "stock_location",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let usage = {
            let u = col(&headers, row, "usage");
            match u {
                "customer" => "customer",
                "supplier" => "supplier",
                "transit" => "transit",
                _ => "internal",
            }
            .to_string()
        };

        ctx.db.stock_location().insert(StockLocation {
            id: 0,
            organization_id,
            name: name.clone(),
            complete_name: opt_str(col(&headers, row, "complete_name")),
            location_id: opt_u64(col(&headers, row, "parent_id")),
            parent_path: "/".to_string(),
            child_ids: vec![],
            child_left: 0,
            child_right: 0,
            usage,
            active: parse_bool(col(&headers, row, "active")),
            scrap_location: parse_bool(col(&headers, row, "is_scrap")),
            return_location: false,
            company_id: Some(company_id),
            posx: 0.0,
            posy: 0.0,
            posz: 0.0,
            barcode: opt_str(col(&headers, row, "barcode")),
            comment: None,
            cyclic_inventory_frequency: 0,
            last_inventory_date: None,
            next_inventory_date: None,
            location_category: "stock".to_string(),
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import stock_location: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── StockQuant ────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_stock_quant_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "stock_quant", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let product_id = parse_u64(col(&headers, row, "product_id"));
        let location_id = parse_u64(col(&headers, row, "location_id"));

        if product_id == 0 || location_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_id"),
                None,
                "product_id and location_id are required",
            );
            errors += 1;
            continue;
        }

        let quantity = parse_f64(col(&headers, row, "quantity"));
        let reserved_quantity = parse_f64(col(&headers, row, "reserved_quantity"));

        ctx.db.stock_quant().insert(StockQuant {
            id: 0,
            organization_id,
            product_id,
            product_variant_id: None,
            location_id,
            lot_id: opt_u64(col(&headers, row, "lot_id")),
            package_id: None,
            owner_id: None,
            company_id,
            quantity,
            reserved_quantity,
            available_quantity: quantity - reserved_quantity,
            in_date: Some(ctx.timestamp),
            inventory_quantity: quantity,
            inventory_diff_quantity: 0.0,
            inventory_quantity_set: false,
            is_outdated: false,
            user_id: None,
            inventory_date: None,
            cost: parse_f64(col(&headers, row, "cost")),
            value: quantity * parse_f64(col(&headers, row, "cost")),
            cost_method: None,
            accounting_date: None,
            currency_id: None,
            accounting_entry_ids: vec![],
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import stock_quant: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── StockProductionLot ────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_lot_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_production_lot", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "stock_production_lot",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();
        let product_id = parse_u64(col(&headers, row, "product_id"));

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.stock_production_lot().insert(StockProductionLot {
            id: 0,
            organization_id,
            name,
            ref_: opt_str(col(&headers, row, "ref_")),
            product_id,
            product_variant_id: None,
            company_id,
            note: opt_str(col(&headers, row, "note")),
            expiration_date: opt_timestamp(col(&headers, row, "expiration_date")),
            use_date: opt_timestamp(col(&headers, row, "use_date")),
            removal_date: opt_timestamp(col(&headers, row, "removal_date")),
            alert_date: None,
            product_qty: 0.0,
            location_id: None,
            package_id: None,
            owner_id: None,
            is_scrap: false,
            is_locked: false,
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import lot: imported={}, errors={}", imported, errors);
    Ok(())
}
