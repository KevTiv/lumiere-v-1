/// Product Category Management Module
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProductCategory** | Product classification hierarchy with parent-child relationships |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ============================================================================
// TABLES
// ============================================================================

/// ProductCategory — Hierarchical classification for products
#[derive(Clone)]
#[spacetimedb::table(
    accessor = product_category,
    public,
    index(name = "by_parent", accessor = category_by_parent, btree(columns = [parent_id])),
    index(name = "by_sequence", accessor = category_by_sequence, btree(columns = [sequence])),
    index(name = "by_name", accessor = category_by_name, btree(columns = [name]))
)]
pub struct ProductCategory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub parent_id: Option<u64>,
    pub sequence: u32,
    pub deleted_at: Option<Timestamp>,
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a new product category
#[reducer]
pub fn create_product_category(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    parent_id: Option<u64>,
    sequence: u32,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "product_category", "create")?;

    if name.trim().is_empty() {
        return Err("Category name cannot be empty".to_string());
    }

    // Validate parent exists if specified
    if let Some(parent_id) = parent_id {
        ctx.db
            .product_category()
            .id()
            .find(&parent_id)
            .ok_or("Parent category not found")?;
    }

    let category = ctx.db.product_category().insert(ProductCategory {
        id: 0,
        name: name.trim().to_string(),
        parent_id,
        sequence,
        deleted_at: None,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "product_category",
        category.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!(
        "Product category created: id={}, name='{}', parent_id={:?}",
        category.id,
        category.name,
        category.parent_id
    );
    Ok(())
}

/// Update a product category
#[reducer]
pub fn update_product_category(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    category_id: u64,
    name: Option<String>,
    parent_id: Option<u64>,
    sequence: Option<u32>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "product_category", "write")?;

    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    // Validate parent exists if specified
    if let Some(parent_id) = parent_id {
        if Some(parent_id) != category.parent_id {
            ctx.db
                .product_category()
                .id()
                .find(&parent_id)
                .ok_or("Parent category not found")?;
        }
    }

    // Prevent circular references
    if let Some(parent_id) = parent_id {
        if has_circular_reference(ctx, category_id, parent_id)? {
            return Err("Circular reference detected".to_string());
        }
    }

    let updated_name = name
        .map(|n| n.trim().to_string())
        .or_else(|| Some(category.name.clone()));

    if updated_name.is_none() {
        return Err("Category name cannot be empty".to_string());
    }

    ctx.db.product_category().id().update(ProductCategory {
        name: updated_name.unwrap(),
        parent_id: parent_id.or(category.parent_id),
        sequence: sequence.unwrap_or(category.sequence),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..category
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "product_category",
        category_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("Product category updated: id={}", category_id);
    Ok(())
}

/// Soft delete a product category
#[reducer]
pub fn delete_product_category(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    category_id: u64,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "product_category", "delete")?;

    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    if category.deleted_at.is_some() {
        return Ok(()); // Idempotent
    }

    ctx.db.product_category().id().update(ProductCategory {
        deleted_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..category
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "product_category",
        category_id,
        "delete",
        None,
        None,
        vec!["deleted".to_string()],
    );

    log::info!("Product category deleted: id={}", category_id);
    Ok(())
}

/// Restore a soft-deleted product category
#[reducer]
pub fn restore_product_category(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    category_id: u64,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "product_category", "write")?;

    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    if category.deleted_at.is_none() {
        return Ok(()); // Idempotent
    }

    ctx.db.product_category().id().update(ProductCategory {
        deleted_at: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..category
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "product_category",
        category_id,
        "write",
        None,
        None,
        vec!["restored".to_string()],
    );

    log::info!("Product category restored: id={}", category_id);
    Ok(())
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Check for circular references in category hierarchy
fn has_circular_reference(
    ctx: &ReducerContext,
    category_id: u64,
    new_parent_id: u64,
) -> Result<bool, String> {
    let mut current_id = new_parent_id;
    let mut visited = vec![new_parent_id];

    while let Some(parent) = ctx.db.product_category().id().find(&current_id) {
        if parent.id == category_id {
            return Ok(true); // Circular reference detected
        }

        if let Some(parent_id) = parent.parent_id {
            if visited.contains(&parent_id) {
                break; // Already visited, no circular reference
            }
            current_id = parent_id;
            visited.push(parent_id);
        } else {
            break; // Reached root
        }
    }

    Ok(false)
}
