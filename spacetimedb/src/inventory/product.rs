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
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use serde_json;
use std::collections::{HashMap, VecDeque};

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.1: PRODUCT CATEGORY
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = product_category,
    public,
    index(accessor = product_categ_by_org, btree(columns = [organization_id])),
    index(accessor = product_categ_by_parent, btree(columns = [parent_id]))
)]
#[derive(Clone)]
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
    pub deleted_at: Option<Timestamp>,
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
// ── Input Params ──────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProductCategoryParams {
    pub name: String,
    pub parent_id: Option<u64>,
    pub description: Option<String>,
    pub sequence: i32,
    pub color: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductCategoryParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub sequence: Option<i32>,
    pub color: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProductParams {
    // Required fields
    pub name: String,
    pub categ_id: u64,
    pub type_: String,
    pub uom_id: u64,
    pub uom_po_id: u64,
    pub standard_price: f64,
    pub list_price: f64,
    pub currency_id: u64,

    // Basic optional fields
    pub default_code: Option<String>,
    pub barcode: Option<String>,
    pub description: Option<String>,
    pub sale_ok: Option<bool>,
    pub purchase_ok: Option<bool>,

    // Product configuration
    pub display_name: Option<String>,
    pub cost_method: Option<String>,
    pub valuation: Option<String>,
    pub volume: Option<f64>,
    pub weight: Option<f64>,
    pub can_be_expensed: Option<bool>,
    pub available_in_pos: Option<bool>,
    pub invoicing_policy: Option<String>,
    pub expense_policy: Option<String>,
    pub priority: Option<String>,
    pub is_published: Option<bool>,

    // Descriptions
    pub description_purchase: Option<String>,
    pub description_sale: Option<String>,
    pub service_type: Option<String>,
    pub service_tracking: Option<String>,

    // Images
    pub image_1920_url: Option<String>,
    pub image_128_url: Option<String>,
    pub color: Option<String>,

    // Responsibility
    pub responsible_id: Option<Identity>,
    pub pricelist_id: Option<u64>,

    // Inventory
    pub description_picking: Option<String>,
    pub description_pickingout: Option<String>,
    pub description_pickingin: Option<String>,
    pub location_id: Option<u64>,
    pub warehouse_id: Option<u64>,

    // Inventory configuration
    pub tracking: Option<String>,
    pub has_configurable_attributes: Option<bool>,

    // Tax configuration
    pub taxes_id: Option<Vec<u64>>,
    pub supplier_taxes_id: Option<Vec<u64>>,

    // Route configuration
    pub route_ids: Option<Vec<u64>>,
    pub route_from_categ_ids: Option<Vec<u64>>,

    // Accounting
    pub property_account_income_id: Option<u64>,
    pub property_account_expense_id: Option<u64>,

    // Variants — always empty on create; populated via create_product_variant
    pub variant_attribute_ids: Option<Vec<u64>>,
    pub attribute_line_ids: Option<Vec<u64>>,

    // Metadata
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductParams {
    pub name: Option<String>,
    pub categ_id: Option<u64>,
    pub standard_price: Option<f64>,
    pub list_price: Option<f64>,
    pub description: Option<String>,
    pub sale_ok: Option<bool>,
    pub purchase_ok: Option<bool>,
    pub active: Option<bool>,
    pub is_published: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductPricingParams {
    pub standard_price: Option<f64>,
    pub list_price: Option<f64>,
    pub currency_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductInventoryDataParams {
    pub qty_available: Option<f64>,
    pub virtual_available: Option<f64>,
    pub incoming_qty: Option<f64>,
    pub outgoing_qty: Option<f64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProductVariantParams {
    pub name: String,
    pub attribute_value_ids: Vec<u64>,
    pub standard_price: f64,
    pub lst_price: f64,
    pub default_code: Option<String>,
    pub barcode: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductVariantParams {
    pub name: Option<String>,
    pub standard_price: Option<f64>,
    pub lst_price: Option<f64>,
    pub default_code: Option<String>,
    pub barcode: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProductSupplierInfoParams {
    pub partner_id: u64,
    pub product_tmpl_id: Option<u64>,
    pub product_id: Option<u64>,
    pub min_qty: f64,
    pub price: f64,
    pub currency_id: u64,
    pub delay: i32,
    pub sequence: i32,
    pub product_name: Option<String>,
    pub product_code: Option<String>,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductSupplierInfoParams {
    pub min_qty: Option<f64>,
    pub price: Option<f64>,
    pub delay: Option<i32>,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProductPackagingParams {
    pub name: String,
    pub qty: f64,
    pub uom_id: u64,
    pub barcode: Option<String>,
    pub length: f64,
    pub width: f64,
    pub height: f64,
    pub weight: f64,
    pub max_weight: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductPackagingParams {
    pub name: Option<String>,
    pub qty: Option<f64>,
    pub barcode: Option<String>,
    pub length: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub weight: Option<f64>,
    pub max_weight: Option<f64>,
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS: PRODUCT CATEGORY HIERARCHY
// ══════════════════════════════════════════════════════════════════════════════

fn build_category_maps(
    ctx: &ReducerContext,
    organization_id: u64,
) -> (
    HashMap<u64, ProductCategory>,
    HashMap<Option<u64>, Vec<u64>>,
) {
    let mut by_id: HashMap<u64, ProductCategory> = HashMap::new();
    let mut children_by_parent: HashMap<Option<u64>, Vec<u64>> = HashMap::new();

    for cat in ctx
        .db
        .product_category()
        .iter()
        .filter(|c| c.organization_id == organization_id)
    {
        children_by_parent
            .entry(cat.parent_id)
            .or_default()
            .push(cat.id);
        by_id.insert(cat.id, cat);
    }

    (by_id, children_by_parent)
}

fn compute_complete_name_from_maps(
    by_id: &HashMap<u64, ProductCategory>,
    category: &ProductCategory,
) -> String {
    let mut names: Vec<String> = vec![category.name.clone()];
    let mut current_parent = category.parent_id;

    while let Some(pid) = current_parent {
        if let Some(parent) = by_id.get(&pid) {
            names.push(parent.name.clone());
            current_parent = parent.parent_id;
        } else {
            break;
        }
    }

    names.reverse();
    names.join(" / ")
}

fn recompute_category_subtree_complete_names(
    ctx: &ReducerContext,
    organization_id: u64,
    root_id: u64,
) -> Result<(), String> {
    let (mut by_id, children_by_parent) = build_category_maps(ctx, organization_id);

    if !by_id.contains_key(&root_id) {
        return Err("Category not found for subtree recomputation".to_string());
    }

    let mut queue: VecDeque<u64> = VecDeque::new();
    queue.push_back(root_id);

    while let Some(current_id) = queue.pop_front() {
        let current = by_id
            .get(&current_id)
            .cloned()
            .ok_or("Category disappeared during subtree recomputation")?;

        let complete_name = compute_complete_name_from_maps(&by_id, &current);

        let updated = ProductCategory {
            complete_name: Some(complete_name),
            updated_at: ctx.timestamp,
            ..current
        };

        ctx.db.product_category().id().update(updated.clone());
        by_id.insert(current_id, updated);

        if let Some(children) = children_by_parent.get(&Some(current_id)) {
            for child_id in children {
                queue.push_back(*child_id);
            }
        }
    }

    Ok(())
}

fn has_category_descendants(
    children_by_parent: &HashMap<Option<u64>, Vec<u64>>,
    category_id: u64,
) -> bool {
    children_by_parent
        .get(&Some(category_id))
        .map(|children| !children.is_empty())
        .unwrap_or(false)
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT CATEGORY
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product_category(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateProductCategoryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_category", "create")?;

    if params.name.is_empty() {
        return Err("Category name cannot be empty".to_string());
    }

    let parent_path = if let Some(pid) = params.parent_id {
        let parent = ctx
            .db
            .product_category()
            .id()
            .find(&pid)
            .ok_or("Parent category not found")?;

        if parent.organization_id != organization_id {
            return Err("Parent category belongs to a different organization".to_string());
        }
        if !parent.is_active || parent.deleted_at.is_some() {
            return Err("Parent category is inactive or deleted".to_string());
        }

        format!("{}{}/", parent.parent_path, pid)
    } else {
        "/".to_string()
    };

    let category = ctx.db.product_category().insert(ProductCategory {
        id: 0,
        organization_id,
        name: params.name.clone(),
        complete_name: Some(params.name.clone()),
        parent_id: params.parent_id,
        parent_path,
        description: params.description,
        sequence: params.sequence,
        color: params.color,
        image_url: None,
        property_ids: vec![], // populated via dedicated relation reducers
        removal_strategy_id: None,
        total_route_ids: vec![], // populated via route assignment reducers
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_category",
            record_id: category.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_category(
    ctx: &ReducerContext,
    organization_id: u64,
    category_id: u64,
    params: UpdateProductCategoryParams,
) -> Result<(), String> {
    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    if category.organization_id != organization_id {
        return Err("Category belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product_category", "write")?;

    if category.deleted_at.is_some() {
        return Err("Cannot update a deleted category".to_string());
    }

    let new_name = params.name.unwrap_or_else(|| category.name.clone());

    ctx.db.product_category().id().update(ProductCategory {
        name: new_name,
        description: params.description.or(category.description),
        sequence: params.sequence.unwrap_or(category.sequence),
        color: params.color.or(category.color),
        is_active: params.is_active.unwrap_or(category.is_active),
        updated_at: ctx.timestamp,
        ..category
    });

    recompute_category_subtree_complete_names(ctx, organization_id, category_id)?;

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_product_category(
    ctx: &ReducerContext,
    organization_id: u64,
    category_id: u64,
    cascade: bool,
) -> Result<(), String> {
    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    if category.organization_id != organization_id {
        return Err("Category belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product_category", "delete")?;

    if category.deleted_at.is_some() {
        return Err("Category is already deleted".to_string());
    }

    let (_by_id, children_by_parent) = build_category_maps(ctx, organization_id);

    if has_category_descendants(&children_by_parent, category_id) && !cascade {
        return Err("Category has descendants; set cascade=true to delete subtree".to_string());
    }

    let mut queue: VecDeque<u64> = VecDeque::new();
    queue.push_back(category_id);

    while let Some(current_id) = queue.pop_front() {
        let current = ctx
            .db
            .product_category()
            .id()
            .find(&current_id)
            .ok_or("Category not found during delete cascade")?;

        if let Some(children) = children_by_parent.get(&Some(current_id)) {
            for child_id in children {
                queue.push_back(*child_id);
            }
        }

        if current.deleted_at.is_none() {
            ctx.db.product_category().id().update(ProductCategory {
                is_active: false,
                deleted_at: Some(ctx.timestamp),
                updated_at: ctx.timestamp,
                ..current
            });
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_category",
            record_id: category_id,
            action: "DELETE",
            old_values: None,
            new_values: Some(serde_json::json!({ "cascade": cascade }).to_string()),
            changed_fields: vec!["deleted_at".to_string(), "is_active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateProductParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product", "create")?;

    if params.name.is_empty() {
        return Err("Product name cannot be empty".to_string());
    }

    let category = ctx
        .db
        .product_category()
        .id()
        .find(&params.categ_id)
        .ok_or("Category not found")?;

    if category.organization_id != organization_id {
        return Err("Category belongs to a different organization".to_string());
    }
    if !category.is_active || category.deleted_at.is_some() {
        return Err("Category is inactive or deleted".to_string());
    }

    let product = ctx.db.product().insert(Product {
        id: 0,
        organization_id,
        name: params.name.clone(),
        display_name: params.display_name.or(Some(params.name.clone())),
        code: params.default_code.clone(),
        default_code: params.default_code.clone(),
        barcode: params.barcode.clone(),
        categ_id: params.categ_id,
        type_: params.type_.clone(),
        uom_id: params.uom_id,
        uom_po_id: params.uom_po_id,
        description: params.description,
        description_purchase: params.description_purchase,
        description_sale: params.description_sale,
        cost_method: params.cost_method.unwrap_or_else(|| "standard".to_string()),
        valuation: params
            .valuation
            .unwrap_or_else(|| "manual_periodic".to_string()),
        standard_price: params.standard_price,
        volume: params.volume.unwrap_or(0.0),
        weight: params.weight.unwrap_or(0.0),
        sale_ok: params.sale_ok.unwrap_or(true),
        purchase_ok: params.purchase_ok.unwrap_or(true),
        can_be_expensed: params.can_be_expensed.unwrap_or(false),
        available_in_pos: params.available_in_pos.unwrap_or(false),
        invoicing_policy: params
            .invoicing_policy
            .unwrap_or_else(|| "order".to_string()),
        expense_policy: params.expense_policy.unwrap_or_else(|| "no".to_string()),
        service_type: params.service_type,
        service_tracking: params.service_tracking,
        image_1920_url: params.image_1920_url,
        image_128_url: params.image_128_url,
        color: params.color,
        priority: params.priority.unwrap_or_else(|| "normal".to_string()),
        is_published: params.is_published.unwrap_or(false),
        active: true,
        responsible_id: params.responsible_id,
        seller_ids: vec![], // populated via create_product_supplier_info
        variant_count: 0,
        variant_attribute_ids: params.variant_attribute_ids.unwrap_or_default(),
        attribute_line_ids: params.attribute_line_ids.unwrap_or_default(),
        value_extra_price_ids: vec![], // populated via attribute value pricing reducers
        product_variant_count: 0,
        product_variant_ids: vec![], // populated via create_product_variant
        currency_id: params.currency_id,
        public_price: params.list_price,
        list_price: params.list_price,
        lst_price: params.list_price,
        price: params.list_price,
        pricelist_id: params.pricelist_id,
        taxes_id: params.taxes_id.unwrap_or_default(),
        supplier_taxes_id: params.supplier_taxes_id.unwrap_or_default(),
        route_from_categ_ids: params.route_from_categ_ids.unwrap_or_default(),
        route_ids: params.route_ids.unwrap_or_default(),
        tracking: params.tracking.unwrap_or_else(|| "none".to_string()),
        description_picking: params.description_picking,
        description_pickingout: params.description_pickingout,
        description_pickingin: params.description_pickingin,
        qty_available: 0.0,
        virtual_available: 0.0,
        incoming_qty: 0.0,
        outgoing_qty: 0.0,
        location_id: params.location_id,
        warehouse_id: params.warehouse_id,
        has_configurable_attributes: params.has_configurable_attributes.unwrap_or(false),
        property_account_income_id: params.property_account_income_id,
        property_account_expense_id: params.property_account_expense_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product",
            record_id: product.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "categ_id": params.categ_id,
                    "type": params.type_,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "categ_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    params: UpdateProductParams,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    if product.organization_id != organization_id {
        return Err("Product belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product", "write")?;

    let new_name = params.name.clone().unwrap_or_else(|| product.name.clone());
    let new_list_price = params.list_price.unwrap_or(product.list_price);

    let resolved_categ_id = if let Some(cid) = params.categ_id {
        let category = ctx
            .db
            .product_category()
            .id()
            .find(&cid)
            .ok_or("Category not found")?;
        if category.organization_id != organization_id {
            return Err("Category belongs to a different organization".to_string());
        }
        if !category.is_active || category.deleted_at.is_some() {
            return Err("Category is inactive or deleted".to_string());
        }
        cid
    } else {
        product.categ_id
    };

    ctx.db.product().id().update(Product {
        name: new_name.clone(),
        display_name: Some(new_name),
        categ_id: resolved_categ_id,
        standard_price: params.standard_price.unwrap_or(product.standard_price),
        list_price: new_list_price,
        lst_price: new_list_price,
        price: new_list_price,
        public_price: new_list_price,
        description: params.description.or(product.description),
        sale_ok: params.sale_ok.unwrap_or(product.sale_ok),
        purchase_ok: params.purchase_ok.unwrap_or(product.purchase_ok),
        active: params.active.unwrap_or(product.active),
        is_published: params.is_published.unwrap_or(product.is_published),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product",
            record_id: product_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "product_id": product_id }).to_string()),
            changed_fields: vec![
                "name".to_string(),
                "categ_id".to_string(),
                "list_price".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_pricing(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    params: UpdateProductPricingParams,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    if product.organization_id != organization_id {
        return Err("Product belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product", "write")?;

    let new_list_price = params.list_price.unwrap_or(product.list_price);

    ctx.db.product().id().update(Product {
        standard_price: params.standard_price.unwrap_or(product.standard_price),
        list_price: new_list_price,
        lst_price: new_list_price,
        price: new_list_price,
        public_price: new_list_price,
        currency_id: params.currency_id.unwrap_or(product.currency_id),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product",
            record_id: product_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "product_id": product_id, "list_price": new_list_price })
                    .to_string(),
            ),
            changed_fields: vec![
                "standard_price".to_string(),
                "list_price".to_string(),
                "currency_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_inventory_data(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    params: UpdateProductInventoryDataParams,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    if product.organization_id != organization_id {
        return Err("Product belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product", "write")?;

    ctx.db.product().id().update(Product {
        qty_available: params.qty_available.unwrap_or(product.qty_available),
        virtual_available: params
            .virtual_available
            .unwrap_or(product.virtual_available),
        incoming_qty: params.incoming_qty.unwrap_or(product.incoming_qty),
        outgoing_qty: params.outgoing_qty.unwrap_or(product.outgoing_qty),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product",
            record_id: product_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "product_id": product_id }).to_string()),
            changed_fields: vec![
                "qty_available".to_string(),
                "virtual_available".to_string(),
                "incoming_qty".to_string(),
                "outgoing_qty".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_product(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
) -> Result<(), String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    if product.organization_id != organization_id {
        return Err("Product belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product", "delete")?;

    let product_name = product.name.clone();

    ctx.db.product().id().update(Product {
        active: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..product
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product",
            record_id: product_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": product_name }).to_string()),
            new_values: None,
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
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
    params: CreateProductVariantParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_variant", "create")?;

    if params.name.is_empty() {
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
        name: params.name.clone(),
        display_name: Some(params.name.clone()),
        default_code: params.default_code,
        barcode: params.barcode,
        combination_indices: None,
        is_product_variant: true,
        attribute_value_ids: params.attribute_value_ids,
        volume: 0.0,
        weight: 0.0,
        standard_price: params.standard_price,
        lst_price: params.lst_price,
        price: params.lst_price,
        price_extra: 0.0,
        qty_available: 0.0,
        virtual_available: 0.0,
        incoming_qty: 0.0,
        outgoing_qty: 0.0,
        orderpoint_ids: vec![], // populated via reorder rule reducers
        nbr_reordering_rules: 0,
        reordering_min_qty: 0.0,
        reordering_max_qty: 0.0,
        product_template_attribute_value_ids: vec![], // populated via attribute line reducers
        combination_indices_dict: None,
        is_active: true,
        metadata: None,
    });

    // Maintain the denormalised product_variant_ids / variant_count on the template
    let template = ctx.db.product().id().find(&product_tmpl_id);
    if let Some(mut p) = template {
        p.product_variant_ids.push(variant.id);
        p.variant_count += 1;
        ctx.db.product().id().update(p);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_variant",
            record_id: variant.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "product_tmpl_id": product_tmpl_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_variant(
    ctx: &ReducerContext,
    organization_id: u64,
    variant_id: u64,
    params: UpdateProductVariantParams,
) -> Result<(), String> {
    let variant = ctx
        .db
        .product_variant()
        .id()
        .find(&variant_id)
        .ok_or("Variant not found")?;

    if variant.organization_id != organization_id {
        return Err("Variant belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product_variant", "write")?;

    let new_name = params.name.unwrap_or_else(|| variant.name.clone());
    let new_lst_price = params.lst_price.unwrap_or(variant.lst_price);

    ctx.db.product_variant().id().update(ProductVariant {
        name: new_name.clone(),
        display_name: Some(new_name),
        standard_price: params.standard_price.unwrap_or(variant.standard_price),
        lst_price: new_lst_price,
        price: new_lst_price,
        default_code: params.default_code.or(variant.default_code),
        barcode: params.barcode.or(variant.barcode),
        is_active: params.is_active.unwrap_or(variant.is_active),
        ..variant
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_variant",
            record_id: variant_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "variant_id": variant_id }).to_string()),
            changed_fields: vec![
                "name".to_string(),
                "standard_price".to_string(),
                "lst_price".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT SUPPLIER INFO
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product_supplier_info(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateProductSupplierInfoParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_supplier_info", "create")?;

    let supplier_info = ctx.db.product_supplier_info().insert(ProductSupplierInfo {
        id: 0,
        organization_id,
        product_tmpl_id: params.product_tmpl_id,
        product_id: params.product_id,
        partner_id: params.partner_id,
        product_name: params.product_name,
        product_code: params.product_code,
        sequence: params.sequence,
        min_qty: params.min_qty,
        price: params.price,
        currency_id: params.currency_id,
        company_id: None,
        date_start: params.date_start,
        date_end: params.date_end,
        delay: params.delay,
        is_active: true,
        metadata: None,
    });

    // Maintain the denormalised seller_ids list on the product template
    if let Some(ptid) = params.product_tmpl_id {
        let template = ctx.db.product().id().find(&ptid);
        if let Some(mut p) = template {
            p.seller_ids.push(supplier_info.id);
            ctx.db.product().id().update(p);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_supplier_info",
            record_id: supplier_info.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "partner_id": params.partner_id,
                    "price": params.price,
                })
                .to_string(),
            ),
            changed_fields: vec!["partner_id".to_string(), "price".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_supplier_info(
    ctx: &ReducerContext,
    organization_id: u64,
    supplier_info_id: u64,
    params: UpdateProductSupplierInfoParams,
) -> Result<(), String> {
    let supplier_info = ctx
        .db
        .product_supplier_info()
        .id()
        .find(&supplier_info_id)
        .ok_or("Supplier info not found")?;

    if supplier_info.organization_id != organization_id {
        return Err("Supplier info belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product_supplier_info", "write")?;

    ctx.db
        .product_supplier_info()
        .id()
        .update(ProductSupplierInfo {
            min_qty: params.min_qty.unwrap_or(supplier_info.min_qty),
            price: params.price.unwrap_or(supplier_info.price),
            delay: params.delay.unwrap_or(supplier_info.delay),
            date_start: params.date_start.or(supplier_info.date_start),
            date_end: params.date_end.or(supplier_info.date_end),
            is_active: params.is_active.unwrap_or(supplier_info.is_active),
            ..supplier_info
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_supplier_info",
            record_id: supplier_info_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "supplier_info_id": supplier_info_id }).to_string(),
            ),
            changed_fields: vec![
                "min_qty".to_string(),
                "price".to_string(),
                "delay".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: PRODUCT PACKAGING
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_product_packaging(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    params: CreateProductPackagingParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_packaging", "create")?;

    if params.name.is_empty() {
        return Err("Packaging name cannot be empty".to_string());
    }

    let _product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    let volume = params.length * params.width * params.height;

    let packaging = ctx.db.product_packaging().insert(ProductPackaging {
        id: 0,
        organization_id,
        name: params.name.clone(),
        sequence: 10,
        product_id,
        qty: params.qty,
        uom_id: params.uom_id,
        barcode: params.barcode,
        company_id: None,
        sales: true,
        purchase: true,
        route_ids: vec![], // populated via route assignment reducers
        length: params.length,
        width: params.width,
        height: params.height,
        weight: params.weight,
        max_weight: params.max_weight,
        volume,
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_packaging",
            record_id: packaging.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "product_id": product_id,
                    "qty": params.qty,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "product_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_product_packaging(
    ctx: &ReducerContext,
    organization_id: u64,
    packaging_id: u64,
    params: UpdateProductPackagingParams,
) -> Result<(), String> {
    let packaging = ctx
        .db
        .product_packaging()
        .id()
        .find(&packaging_id)
        .ok_or("Packaging not found")?;

    if packaging.organization_id != organization_id {
        return Err("Packaging belongs to a different organization".to_string());
    }

    check_permission(ctx, organization_id, "product_packaging", "write")?;

    let new_length = params.length.unwrap_or(packaging.length);
    let new_width = params.width.unwrap_or(packaging.width);
    let new_height = params.height.unwrap_or(packaging.height);
    let volume = new_length * new_width * new_height;

    ctx.db.product_packaging().id().update(ProductPackaging {
        name: params.name.unwrap_or_else(|| packaging.name.clone()),
        qty: params.qty.unwrap_or(packaging.qty),
        barcode: params.barcode.or(packaging.barcode),
        length: new_length,
        width: new_width,
        height: new_height,
        weight: params.weight.unwrap_or(packaging.weight),
        max_weight: params.max_weight.unwrap_or(packaging.max_weight),
        volume,
        ..packaging
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_packaging",
            record_id: packaging_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "packaging_id": packaging_id }).to_string()),
            changed_fields: vec![
                "name".to_string(),
                "qty".to_string(),
                "length".to_string(),
                "width".to_string(),
                "height".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}
