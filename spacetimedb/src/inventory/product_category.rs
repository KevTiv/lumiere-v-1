/// Product Category Management Module
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProductCategory** | Product classification hierarchy with parent-child relationships |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ───────────────────────────────────────────────────────────────────

/// ProductCategory — Hierarchical classification for products
#[derive(Clone)]
#[spacetimedb::table(
    accessor = product_category,
    public,
    index(accessor = category_by_org, btree(columns = [organization_id])),
    index(accessor = category_by_parent, btree(columns = [parent_id])),
    index(accessor = category_by_sequence, btree(columns = [sequence])),
    index(accessor = category_by_name, btree(columns = [name]))
)]
pub struct ProductCategory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProductCategoryParams {
    pub name: String,
    pub parent_id: Option<u64>,
    pub sequence: u32,
    /// None = org-wide category (not company-specific)
    pub company_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProductCategoryParams {
    pub name: Option<String>,
    pub parent_id: Option<u64>,
    pub sequence: Option<u32>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new product category
#[reducer]
pub fn create_product_category(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateProductCategoryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_category", "create")?;

    if params.name.trim().is_empty() {
        return Err("Category name cannot be empty".to_string());
    }

    if let Some(parent_id) = params.parent_id {
        ctx.db
            .product_category()
            .id()
            .find(&parent_id)
            .ok_or("Parent category not found")?;
    }

    let category = ctx.db.product_category().insert(ProductCategory {
        id: 0,
        organization_id,
        name: params.name.trim().to_string(),
        parent_id: params.parent_id,
        sequence: params.sequence,
        deleted_at: None,
        company_id: params.company_id,
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
            company_id: params.company_id,
            table_name: "product_category",
            record_id: category.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": category.name,
                    "parent_id": category.parent_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
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
    organization_id: u64,
    category_id: u64,
    params: UpdateProductCategoryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_category", "write")?;

    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    if category.organization_id != organization_id {
        return Err("Category does not belong to this organization".to_string());
    }

    if let Some(parent_id) = params.parent_id {
        if Some(parent_id) != category.parent_id {
            ctx.db
                .product_category()
                .id()
                .find(&parent_id)
                .ok_or("Parent category not found")?;
        }
        if has_circular_reference(ctx, category_id, parent_id)? {
            return Err("Circular reference detected".to_string());
        }
    }

    let new_name = match params.name {
        Some(n) => {
            let trimmed = n.trim().to_string();
            if trimmed.is_empty() {
                return Err("Category name cannot be empty".to_string());
            }
            trimmed
        }
        None => category.name.clone(),
    };

    let old_values =
        serde_json::json!({ "name": category.name, "parent_id": category.parent_id }).to_string();

    ctx.db.product_category().id().update(ProductCategory {
        name: new_name,
        parent_id: params.parent_id.or(category.parent_id),
        sequence: params.sequence.unwrap_or(category.sequence),
        metadata: params.metadata.or(category.metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..category
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: category.company_id,
            table_name: "product_category",
            record_id: category_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields: vec!["name".to_string(), "parent_id".to_string()],
            metadata: None,
        },
    );

    log::info!("Product category updated: id={}", category_id);
    Ok(())
}

/// Soft delete a product category
#[reducer]
pub fn delete_product_category(
    ctx: &ReducerContext,
    organization_id: u64,
    category_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_category", "delete")?;

    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    if category.organization_id != organization_id {
        return Err("Category does not belong to this organization".to_string());
    }

    if category.deleted_at.is_some() {
        return Ok(()); // Idempotent
    }

    let category_name = category.name.clone();
    let category_company_id = category.company_id;
    ctx.db.product_category().id().update(ProductCategory {
        deleted_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..category
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: category_company_id,
            table_name: "product_category",
            record_id: category_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": category_name }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted_at".to_string()],
            metadata: None,
        },
    );

    log::info!("Product category deleted: id={}", category_id);
    Ok(())
}

/// Restore a soft-deleted product category
#[reducer]
pub fn restore_product_category(
    ctx: &ReducerContext,
    organization_id: u64,
    category_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_category", "write")?;

    let category = ctx
        .db
        .product_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    if category.organization_id != organization_id {
        return Err("Category does not belong to this organization".to_string());
    }

    if category.deleted_at.is_none() {
        return Ok(()); // Idempotent
    }

    ctx.db.product_category().id().update(ProductCategory {
        deleted_at: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..category
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: category.company_id,
            table_name: "product_category",
            record_id: category_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "deleted_at": "set" }).to_string()),
            new_values: Some(serde_json::json!({ "deleted_at": null }).to_string()),
            changed_fields: vec!["deleted_at".to_string()],
            metadata: None,
        },
    );

    log::info!("Product category restored: id={}", category_id);
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
