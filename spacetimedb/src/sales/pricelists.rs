/// Pricelists — ProductPricelist & ProductPricelistItem
///
/// Backs the `pricelist_id` foreign key on SaleOrder, Product, Opportunity,
/// POSConfig, POSTransaction, SubscriptionTemplate, and IntercompanyRule.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{ComputePrice, DiscountPolicy, PricelistAppliedOn};

// ── Tables ────────────────────────────────────────────────────────────────────

/// Product Pricelist — Defines a named pricing strategy for an organization.
#[spacetimedb::table(
    accessor = product_pricelist,
    public,
    index(accessor = pricelist_by_org, btree(columns = [organization_id]))
)]
pub struct ProductPricelist {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub currency_id: u64,
    pub discount_policy: DiscountPolicy, // WithDiscount | WithoutDiscount
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// Product Pricelist Item — A single pricing rule within a pricelist.
/// Rules can apply to all products, a category, or a specific product/variant.
#[spacetimedb::table(
    accessor = product_pricelist_item,
    public,
    index(accessor = pricelist_item_by_pricelist, btree(columns = [pricelist_id]))
)]
pub struct ProductPricelistItem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pricelist_id: u64,
    pub applied_on: PricelistAppliedOn, // AllProducts | Category | Product
    pub compute_price: ComputePrice,    // Fixed | Percentage | Formula
    pub product_tmpl_id: Option<u64>,   // FK → Product template (when applied_on = Product)
    pub product_id: Option<u64>,        // FK → Product variant
    pub categ_id: Option<u64>,          // FK → ProductCategory (when applied_on = Category)
    pub min_quantity: f64,              // Minimum quantity to apply this rule
    pub date_start: Option<Timestamp>,  // Rule validity start
    pub date_end: Option<Timestamp>,    // Rule validity end
    pub fixed_price: f64,               // Used when compute_price = Fixed
    pub percent_price: f64,             // Used when compute_price = Percentage (0–100)
    pub price_discount: f64,            // Formula: discount off base price (0–100)
    pub price_surcharge: f64,           // Formula: fixed amount added after discount
    pub price_min_margin: f64,          // Formula: minimum margin (0–100)
    pub price_max_margin: f64,          // Formula: maximum margin (0–100)
    pub sequence: u32,                  // Processing order (lower = higher priority)
}

// ── Params ────────────────────────────────────────────────────────────────────

#[derive(SpacetimeType)]
pub struct CreatePricelistParams {
    pub name: String,
    pub currency_id: u64,
    pub discount_policy: DiscountPolicy,
}

#[derive(SpacetimeType)]
pub struct CreatePricelistItemParams {
    pub pricelist_id: u64,
    pub applied_on: PricelistAppliedOn,
    pub compute_price: ComputePrice,
    pub product_tmpl_id: Option<u64>,
    pub product_id: Option<u64>,
    pub categ_id: Option<u64>,
    pub min_quantity: f64,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub fixed_price: f64,
    pub percent_price: f64,
    pub price_discount: f64,
    pub price_surcharge: f64,
    pub price_min_margin: f64,
    pub price_max_margin: f64,
    pub sequence: u32,
}

// ── Reducers: Pricelist ───────────────────────────────────────────────────────

#[reducer]
pub fn create_pricelist(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePricelistParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "pricelist", "create")?;
    if params.name.is_empty() {
        return Err("Pricelist name cannot be empty".to_string());
    }
    let pl = ctx.db.product_pricelist().insert(ProductPricelist {
        id: 0,
        organization_id,
        name: params.name,
        currency_id: params.currency_id,
        discount_policy: params.discount_policy,
        is_active: true,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "product_pricelist",
            record_id: pl.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_pricelist(
    ctx: &ReducerContext,
    organization_id: u64,
    pricelist_id: u64,
    name: Option<String>,
    currency_id: Option<u64>,
    discount_policy: Option<DiscountPolicy>,
    is_active: Option<bool>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "pricelist", "update")?;
    let pl = ctx
        .db
        .product_pricelist()
        .id()
        .find(&pricelist_id)
        .ok_or("Pricelist not found")?;
    if pl.organization_id != organization_id {
        return Err("Pricelist belongs to a different organization".to_string());
    }
    ctx.db.product_pricelist().id().update(ProductPricelist {
        name: name.unwrap_or(pl.name.clone()),
        currency_id: currency_id.unwrap_or(pl.currency_id),
        discount_policy: discount_policy.unwrap_or(pl.discount_policy.clone()),
        is_active: is_active.unwrap_or(pl.is_active),
        ..pl
    });
    Ok(())
}

#[reducer]
pub fn delete_pricelist(
    ctx: &ReducerContext,
    organization_id: u64,
    pricelist_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "pricelist", "delete")?;
    let pl = ctx
        .db
        .product_pricelist()
        .id()
        .find(&pricelist_id)
        .ok_or("Pricelist not found")?;
    if pl.organization_id != organization_id {
        return Err("Pricelist belongs to a different organization".to_string());
    }
    ctx.db.product_pricelist().id().delete(&pricelist_id);
    // Cascade: delete all items
    let item_ids: Vec<u64> = ctx
        .db
        .product_pricelist_item()
        .pricelist_item_by_pricelist()
        .filter(&pricelist_id)
        .map(|i| i.id)
        .collect();
    for iid in item_ids {
        ctx.db.product_pricelist_item().id().delete(&iid);
    }
    Ok(())
}

// ── Reducers: Pricelist Items ─────────────────────────────────────────────────

#[reducer]
pub fn create_pricelist_item(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePricelistItemParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "pricelist", "update")?;
    let pl = ctx
        .db
        .product_pricelist()
        .id()
        .find(&params.pricelist_id)
        .ok_or("Pricelist not found")?;
    if pl.organization_id != organization_id {
        return Err("Pricelist belongs to a different organization".to_string());
    }
    ctx.db
        .product_pricelist_item()
        .insert(ProductPricelistItem {
            id: 0,
            pricelist_id: params.pricelist_id,
            applied_on: params.applied_on,
            compute_price: params.compute_price,
            product_tmpl_id: params.product_tmpl_id,
            product_id: params.product_id,
            categ_id: params.categ_id,
            min_quantity: params.min_quantity,
            date_start: params.date_start,
            date_end: params.date_end,
            fixed_price: params.fixed_price,
            percent_price: params.percent_price,
            price_discount: params.price_discount,
            price_surcharge: params.price_surcharge,
            price_min_margin: params.price_min_margin,
            price_max_margin: params.price_max_margin,
            sequence: params.sequence,
        });
    Ok(())
}

#[reducer]
pub fn delete_pricelist_item(
    ctx: &ReducerContext,
    organization_id: u64,
    item_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "pricelist", "update")?;
    let item = ctx
        .db
        .product_pricelist_item()
        .id()
        .find(&item_id)
        .ok_or("Pricelist item not found")?;
    let pl = ctx
        .db
        .product_pricelist()
        .id()
        .find(&item.pricelist_id)
        .ok_or("Parent pricelist not found")?;
    if pl.organization_id != organization_id {
        return Err("Pricelist belongs to a different organization".to_string());
    }
    ctx.db.product_pricelist_item().id().delete(&item_id);
    Ok(())
}
