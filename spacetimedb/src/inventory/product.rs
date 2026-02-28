/// Product Management — Tables and Reducers
///
/// Tables:
///   - ProductCategory
///   - Product
///   - ProductAttribute
///   - ProductAttributeValue
///   - ProductAttributeLine
///   - ProductVariant
///   - ProductSupplierInfo
///   - ProductPackaging
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.1: PRODUCT CATEGORY
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = product_category,
    public,
    index(accessor = product_categ_by_org, btree(columns = [organization_id])),
    index(accessor = product_categ_by_parent, btree(columns = [parent_id]))
)]
pub struct ProductCategory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub complete_name: Option<String>,
    pub parent_id: Option<u64>,
    pub parent_path: String,
    pub description: Option<String>,
    pub sequence: i32,
    pub color: Option<String>,
    pub image_url: Option<String>,
    pub property_ids: Vec<u64>,
    pub removal_strategy_id: Option<u64>,
    pub total_route_ids: Vec<u64>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.2: PRODUCT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = product,
    public,
    index(accessor = product_by_org, btree(columns = [organization_id])),
    index(accessor = product_by_categ, btree(columns = [categ_id])),
    index(accessor = product_by_barcode, btree(columns = [barcode])),
    index(accessor = product_by_default_code, btree(columns = [default_code]))
)]
pub struct Product {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub display_name: Option<String>,
    pub code: Option<String>,
    pub default_code: Option<String>,
    pub barcode: Option<String>,
    pub categ_id: u64,
    pub type_: String,
    pub uom_id: u64,
    pub uom_po_id: u64,
    pub description: Option<String>,
    pub description_purchase: Option<String>,
    pub description_sale: Option<String>,
    pub cost_method: String,
    pub valuation: String,
    pub standard_price: f64,
    pub volume: f64,
    pub weight: f64,
    pub sale_ok: bool,
    pub purchase_ok: bool,
    pub can_be_expensed: bool,
    pub available_in_pos: bool,
    pub invoicing_policy: String,
    pub expense_policy: String,
    pub service_type: Option<String>,
    pub service_tracking: Option<String>,
    pub image_1920_url: Option<String>,
    pub image_128_url: Option<String>,
    pub color: Option<String>,
    pub priority: String,
    pub is_published: bool,
    pub active: bool,
    pub responsible_id: Option<Identity>,
    pub seller_ids: Vec<u64>,
    pub variant_count: i32,
    pub variant_attribute_ids: Vec<u64>,
    pub attribute_line_ids: Vec<u64>,
    pub value_extra_price_ids: Vec<u64>,
    pub product_variant_count: i32,
    pub product_variant_ids: Vec<u64>,
    pub currency_id: u64,
    pub public_price: f64,
    pub list_price: f64,
    pub lst_price: f64,
    pub price: f64,
    pub pricelist_id: Option<u64>,
    pub taxes_id: Vec<u64>,
    pub supplier_taxes_id: Vec<u64>,
    pub route_from_categ_ids: Vec<u64>,
    pub route_ids: Vec<u64>,
    pub tracking: String,
    pub description_picking: Option<String>,
    pub description_pickingout: Option<String>,
    pub description_pickingin: Option<String>,
    pub qty_available: f64,
    pub virtual_available: f64,
    pub incoming_qty: f64,
    pub outgoing_qty: f64,
    pub location_id: Option<u64>,
    pub warehouse_id: Option<u64>,
    pub has_configurable_attributes: bool,
    pub property_account_income_id: Option<u64>,
    pub property_account_expense_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.3: PRODUCT ATTRIBUTE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = product_attribute,
    public,
    index(accessor = attribute_by_org, btree(columns = [organization_id]))
)]
pub struct ProductAttribute {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub create_variant: String,
    pub display_type: String,
    pub sequence: i32,
    pub value_ids: Vec<u64>,
    pub product_tmpl_ids: Vec<u64>,
    pub attribute_line_ids: Vec<u64>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = product_attribute_value,
    public,
    index(accessor = attr_value_by_org, btree(columns = [organization_id])),
    index(accessor = attr_value_by_attr, btree(columns = [attribute_id]))
)]
pub struct ProductAttributeValue {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub sequence: i32,
    pub attribute_id: u64,
    pub color: Option<String>,
    pub html_color: Option<String>,
    pub is_custom: bool,
    pub display_type: String,
    pub ptav_active: bool,
    pub product_attribute_value_id: Option<u64>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = product_attribute_line,
    public,
    index(accessor = attr_line_by_org, btree(columns = [organization_id])),
    index(accessor = attr_line_by_tmpl, btree(columns = [product_tmpl_id]))
)]
pub struct ProductAttributeLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub product_tmpl_id: u64,
    pub attribute_id: u64,
    pub value_ids: Vec<u64>,
    pub active: bool,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.4: PRODUCT VARIANT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = product_variant,
    public,
    index(accessor = variant_by_org, btree(columns = [organization_id])),
    index(accessor = variant_by_tmpl, btree(columns = [product_tmpl_id])),
    index(accessor = variant_by_barcode, btree(columns = [barcode]))
)]
pub struct ProductVariant {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub product_tmpl_id: u64,
    pub name: String,
    pub display_name: Option<String>,
    pub default_code: Option<String>,
    pub barcode: Option<String>,
    pub combination_indices: Option<String>,
    pub is_product_variant: bool,
    pub attribute_value_ids: Vec<u64>,
    pub volume: f64,
    pub weight: f64,
    pub standard_price: f64,
    pub lst_price: f64,
    pub price: f64,
    pub price_extra: f64,
    pub qty_available: f64,
    pub virtual_available: f64,
    pub incoming_qty: f64,
    pub outgoing_qty: f64,
    pub orderpoint_ids: Vec<u64>,
    pub nbr_reordering_rules: i32,
    pub reordering_min_qty: f64,
    pub reordering_max_qty: f64,
    pub product_template_attribute_value_ids: Vec<u64>,
    pub combination_indices_dict: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.5: PRODUCT SUPPLIER INFO
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = product_supplier_info,
    public,
    index(accessor = supplier_info_by_org, btree(columns = [organization_id])),
    index(accessor = supplier_info_by_partner, btree(columns = [partner_id]))
)]
pub struct ProductSupplierInfo {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub product_tmpl_id: Option<u64>,
    pub product_id: Option<u64>,
    pub partner_id: u64,
    pub product_name: Option<String>,
    pub product_code: Option<String>,
    pub sequence: i32,
    pub min_qty: f64,
    pub price: f64,
    pub currency_id: u64,
    pub company_id: Option<u64>,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub delay: i32,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.6: PRODUCT PACKAGING
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = product_packaging,
    public,
    index(accessor = packaging_by_org, btree(columns = [organization_id])),
    index(accessor = packaging_by_product, btree(columns = [product_id]))
)]
pub struct ProductPackaging {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub sequence: i32,
    pub product_id: u64,
    pub qty: f64,
    pub uom_id: u64,
    pub barcode: Option<String>,
    pub company_id: Option<u64>,
    pub sales: bool,
    pub purchase: bool,
    pub route_ids: Vec<u64>,
    pub length: f64,
    pub width: f64,
    pub height: f64,
    pub weight: f64,
    pub max_weight: f64,
    pub volume: f64,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT CATEGORY
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product_category(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    parent_id: Option<u64>,
    description: Option<String>,
    sequence: i32,
    color: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_category", "create")?;

    if name.is_empty() {
        return Err("Category name cannot be empty".to_string());
    }

    let parent_path = if let Some(pid) = parent_id {
        let parent = ctx
            .db
            .product_category()
            .id()
            .find(&pid)
            .ok_or("Parent category not found")?;
        format!("{}{}/", parent.parent_path, pid)
    } else {
        "/".to_string()
    };

    let category = ctx.db.product_category().insert(ProductCategory {
        id: 0,
        organization_id,
        name: name.clone(),
        complete_name: Some(name.clone()),
        parent_id,
        parent_path,
        description,
        sequence,
        color,
        image_url: None,
        property_ids: vec![],
        removal_strategy_id: None,
        total_route_ids: vec![],
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "product_category",
        category.id,
        "create",
        None,
        Some(format!(r#"{{"name":"{}"}}"#, name)),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_category(
    ctx: &ReducerContext,
    category_id: u64,
    name: Option<String>,
    description: Option<String>,
    sequence: Option<i32>,
    color: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    check_permission(ctx, category.organization_id, "product_category", "write")?;

    let new_name = name.unwrap_or_else(|| category.name.clone());

    ctx.db.product_category().id().update(ProductCategory {
        name: new_name.clone(),
        complete_name: Some(new_name),
        description: description.or(category.description),
        sequence: sequence.unwrap_or(category.sequence),
        color: color.or(category.color),
        is_active: is_active.unwrap_or(category.is_active),
        updated_at: ctx.timestamp,
        ..category
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    categ_id: u64,
    type_: String,
    uom_id: u64,
    uom_po_id: u64,
    standard_price: f64,
    list_price: f64,
    currency_id: u64,
    default_code: Option<String>,
    barcode: Option<String>,
    description: Option<String>,
    sale_ok: bool,
    purchase_ok: bool,
    // Additional product details
    description_purchase: Option<String>,
    description_sale: Option<String>,
    service_type: Option<String>,
    service_tracking: Option<String>,
    image_1920_url: Option<String>,
    image_128_url: Option<String>,
    color: Option<String>,
    responsible_id: Option<Identity>,
    pricelist_id: Option<u64>,
    // Inventory details
    description_picking: Option<String>,
    description_pickingout: Option<String>,
    description_pickingin: Option<String>,
    location_id: Option<u64>,
    warehouse_id: Option<u64>,
    // Accounting details
    property_account_income_id: Option<u64>,
    property_account_expense_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product", "create")?;

    if name.is_empty() {
        return Err("Product name cannot be empty".to_string());
    }

    let _category = ctx
        .db
        .product_category()
        .id()
        .find(&categ_id)
        .ok_or("Category not found")?;

    let product = ctx.db.product().insert(Product {
        id: 0,
        organization_id,
        name: name.clone(),
        display_name: Some(name.clone()),
        code: default_code.clone(),
        default_code: default_code.clone(),
        barcode: barcode.clone(),
        categ_id,
        type_: type_.clone(),
        uom_id,
        uom_po_id,
        description,
        description_purchase,
        description_sale,
        cost_method: "standard".to_string(),
        valuation: "manual_periodic".to_string(),
        standard_price,
        volume: 0.0,
        weight: 0.0,
        sale_ok,
        purchase_ok,
        can_be_expensed: false,
        available_in_pos: false,
        invoicing_policy: "order".to_string(),
        expense_policy: "no".to_string(),
        service_type,
        service_tracking,
        image_1920_url,
        image_128_url,
        color,
        priority: "normal".to_string(),
        is_published: false,
        active: true,
        responsible_id,
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
        pricelist_id,
        taxes_id: vec![],
        supplier_taxes_id: vec![],
        route_from_categ_ids: vec![],
        route_ids: vec![],
        tracking: "none".to_string(),
        description_picking,
        description_pickingout,
        description_pickingin,
        qty_available: 0.0,
        virtual_available: 0.0,
        incoming_qty: 0.0,
        outgoing_qty: 0.0,
        location_id,
        warehouse_id,
        has_configurable_attributes: false,
        property_account_income_id,
        property_account_expense_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "product",
        product.id,
        "create",
        None,
        Some(format!(
            r#"{{"name":"{}","categ_id":{},"type":"{}"}}"#,
            name, categ_id, type_
        )),
        vec!["name".to_string(), "categ_id".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product(
    ctx: &ReducerContext,
    product_id: u64,
    name: Option<String>,
    categ_id: Option<u64>,
    standard_price: Option<f64>,
    list_price: Option<f64>,
    description: Option<String>,
    sale_ok: Option<bool>,
    purchase_ok: Option<bool>,
    active: Option<bool>,
    is_published: Option<bool>,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    check_permission(ctx, product.organization_id, "product", "write")?;

    let new_name = name.clone().unwrap_or_else(|| product.name.clone());
    let new_list_price = list_price.unwrap_or(product.list_price);

    ctx.db.product().id().update(Product {
        name: new_name.clone(),
        display_name: Some(new_name),
        categ_id: categ_id.unwrap_or(product.categ_id),
        standard_price: standard_price.unwrap_or(product.standard_price),
        list_price: new_list_price,
        lst_price: new_list_price,
        price: new_list_price,
        public_price: new_list_price,
        description: description.or(product.description),
        sale_ok: sale_ok.unwrap_or(product.sale_ok),
        purchase_ok: purchase_ok.unwrap_or(product.purchase_ok),
        active: active.unwrap_or(product.active),
        is_published: is_published.unwrap_or(product.is_published),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_pricing(
    ctx: &ReducerContext,
    product_id: u64,
    standard_price: Option<f64>,
    list_price: Option<f64>,
    currency_id: Option<u64>,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    check_permission(ctx, product.organization_id, "product", "write")?;

    let new_list_price = list_price.unwrap_or(product.list_price);

    ctx.db.product().id().update(Product {
        standard_price: standard_price.unwrap_or(product.standard_price),
        list_price: new_list_price,
        lst_price: new_list_price,
        price: new_list_price,
        public_price: new_list_price,
        currency_id: currency_id.unwrap_or(product.currency_id),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_inventory_data(
    ctx: &ReducerContext,
    product_id: u64,
    qty_available: Option<f64>,
    virtual_available: Option<f64>,
    incoming_qty: Option<f64>,
    outgoing_qty: Option<f64>,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    check_permission(ctx, product.organization_id, "product", "write")?;

    ctx.db.product().id().update(Product {
        qty_available: qty_available.unwrap_or(product.qty_available),
        virtual_available: virtual_available.unwrap_or(product.virtual_available),
        incoming_qty: incoming_qty.unwrap_or(product.incoming_qty),
        outgoing_qty: outgoing_qty.unwrap_or(product.outgoing_qty),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_product(ctx: &ReducerContext, product_id: u64) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    check_permission(ctx, product.organization_id, "product", "delete")?;

    let product_name = product.name.clone();

    ctx.db.product().id().update(Product {
        active: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    write_audit_log(
        ctx,
        product.organization_id,
        None,
        "product",
        product_id,
        "delete",
        Some(format!(r#"{{"name":"{}"}}"#, product_name)),
        None,
        vec!["active".to_string()],
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT VARIANT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product_variant(
    ctx: &ReducerContext,
    organization_id: u64,
    product_tmpl_id: u64,
    name: String,
    attribute_value_ids: Vec<u64>,
    standard_price: f64,
    lst_price: f64,
    default_code: Option<String>,
    barcode: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_variant", "create")?;

    if name.is_empty() {
        return Err("Variant name cannot be empty".to_string());
    }

    let _product = ctx
        .db
        .product()
        .id()
        .find(&product_tmpl_id)
        .ok_or("Product template not found")?;

    let variant = ctx.db.product_variant().insert(ProductVariant {
        id: 0,
        organization_id,
        product_tmpl_id,
        name: name.clone(),
        display_name: Some(name.clone()),
        default_code,
        barcode,
        combination_indices: None,
        is_product_variant: true,
        attribute_value_ids,
        volume: 0.0,
        weight: 0.0,
        standard_price,
        lst_price,
        price: lst_price,
        price_extra: 0.0,
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
        is_active: true,
        metadata: None,
    });

    if let Some(mut product) = ctx.db.product().id().find(&product_tmpl_id) {
        product.product_variant_ids.push(variant.id);
        product.variant_count += 1;
        ctx.db.product().id().update(product);
    }

    write_audit_log(
        ctx,
        organization_id,
        None,
        "product_variant",
        variant.id,
        "create",
        None,
        Some(format!(
            r#"{{"name":"{}","product_tmpl_id":{}}}"#,
            name, product_tmpl_id
        )),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_variant(
    ctx: &ReducerContext,
    variant_id: u64,
    name: Option<String>,
    standard_price: Option<f64>,
    lst_price: Option<f64>,
    default_code: Option<String>,
    barcode: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let variant = ctx
        .db
        .product_variant()
        .id()
        .find(&variant_id)
        .ok_or("Variant not found")?;

    check_permission(ctx, variant.organization_id, "product_variant", "write")?;

    let new_name = name.unwrap_or_else(|| variant.name.clone());
    let new_lst_price = lst_price.unwrap_or(variant.lst_price);

    ctx.db.product_variant().id().update(ProductVariant {
        name: new_name.clone(),
        display_name: Some(new_name),
        standard_price: standard_price.unwrap_or(variant.standard_price),
        lst_price: new_lst_price,
        price: new_lst_price,
        default_code: default_code.or(variant.default_code),
        barcode: barcode.or(variant.barcode),
        is_active: is_active.unwrap_or(variant.is_active),
        ..variant
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT SUPPLIER INFO
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product_supplier_info(
    ctx: &ReducerContext,
    organization_id: u64,
    partner_id: u64,
    product_tmpl_id: Option<u64>,
    product_id: Option<u64>,
    min_qty: f64,
    price: f64,
    currency_id: u64,
    delay: i32,
    product_name: Option<String>,
    product_code: Option<String>,
    date_start: Option<Timestamp>,
    date_end: Option<Timestamp>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_supplier_info", "create")?;

    let supplier_info = ctx.db.product_supplier_info().insert(ProductSupplierInfo {
        id: 0,
        organization_id,
        product_tmpl_id,
        product_id,
        partner_id,
        product_name,
        product_code,
        sequence: 10,
        min_qty,
        price,
        currency_id,
        company_id: None,
        date_start,
        date_end,
        delay,
        is_active: true,
        metadata: None,
    });

    if let Some(ptid) = product_tmpl_id {
        if let Some(mut product) = ctx.db.product().id().find(&ptid) {
            product.seller_ids.push(supplier_info.id);
            ctx.db.product().id().update(product);
        }
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_supplier_info(
    ctx: &ReducerContext,
    supplier_info_id: u64,
    min_qty: Option<f64>,
    price: Option<f64>,
    delay: Option<i32>,
    date_start: Option<Timestamp>,
    date_end: Option<Timestamp>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let supplier_info = ctx
        .db
        .product_supplier_info()
        .id()
        .find(&supplier_info_id)
        .ok_or("Supplier info not found")?;

    check_permission(
        ctx,
        supplier_info.organization_id,
        "product_supplier_info",
        "write",
    )?;

    ctx.db
        .product_supplier_info()
        .id()
        .update(ProductSupplierInfo {
            min_qty: min_qty.unwrap_or(supplier_info.min_qty),
            price: price.unwrap_or(supplier_info.price),
            delay: delay.unwrap_or(supplier_info.delay),
            date_start: date_start.or(supplier_info.date_start),
            date_end: date_end.or(supplier_info.date_end),
            is_active: is_active.unwrap_or(supplier_info.is_active),
            ..supplier_info
        });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT PACKAGING
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product_packaging(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    product_id: u64,
    qty: f64,
    uom_id: u64,
    barcode: Option<String>,
    length: f64,
    width: f64,
    height: f64,
    weight: f64,
    max_weight: f64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_packaging", "create")?;

    if name.is_empty() {
        return Err("Packaging name cannot be empty".to_string());
    }

    let _product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    let volume = length * width * height;

    ctx.db.product_packaging().insert(ProductPackaging {
        id: 0,
        organization_id,
        name,
        sequence: 10,
        product_id,
        qty,
        uom_id,
        barcode,
        company_id: None,
        sales: true,
        purchase: true,
        route_ids: vec![],
        length,
        width,
        height,
        weight,
        max_weight,
        volume,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_packaging(
    ctx: &ReducerContext,
    packaging_id: u64,
    name: Option<String>,
    qty: Option<f64>,
    barcode: Option<String>,
    length: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    weight: Option<f64>,
    max_weight: Option<f64>,
) -> Result<(), String> {
    let packaging = ctx
        .db
        .product_packaging()
        .id()
        .find(&packaging_id)
        .ok_or("Packaging not found")?;

    check_permission(ctx, packaging.organization_id, "product_packaging", "write")?;

    let new_length = length.unwrap_or(packaging.length);
    let new_width = width.unwrap_or(packaging.width);
    let new_height = height.unwrap_or(packaging.height);
    let volume = new_length * new_width * new_height;

    ctx.db.product_packaging().id().update(ProductPackaging {
        name: name.unwrap_or_else(|| packaging.name.clone()),
        qty: qty.unwrap_or(packaging.qty),
        barcode: barcode.or(packaging.barcode),
        length: new_length,
        width: new_width,
        height: new_height,
        weight: weight.unwrap_or(packaging.weight),
        max_weight: max_weight.unwrap_or(packaging.max_weight),
        volume,
        ..packaging
    });

    Ok(())
}
