/// Product category domain tests — in-module test helpers.
///
/// Invoked from [`super::run_all_inventory_tests`]; requires SpacetimeDB runtime + superuser.
use spacetimedb::{ReducerContext, Table};

use crate::inventory::product_category::{
    create_product_category, delete_product_category, product_category, restore_product_category,
    update_product_category, CreateProductCategoryParams, UpdateProductCategoryParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_product_category_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    // ── Creation ──────────────────────────────────────────────────────────────
    create_product_category(
        ctx,
        org_id,
        CreateProductCategoryParams {
            name: "Electronics".to_string(),
            parent_id: None,
            sequence: 10,
            company_id: Some(company_id),
            metadata: None,
        },
    )?;

    let root = ctx
        .db
        .product_category()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Electronics")
        .ok_or("Root category not found after create")?;

    if root.parent_id.is_some() {
        return Err("Root category should have no parent".to_string());
    }

    // ── Hierarchy ─────────────────────────────────────────────────────────────
    create_product_category(
        ctx,
        org_id,
        CreateProductCategoryParams {
            name: "Laptops".to_string(),
            parent_id: Some(root.id),
            sequence: 20,
            company_id: Some(company_id),
            metadata: None,
        },
    )?;

    let child = ctx
        .db
        .product_category()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Laptops")
        .ok_or("Child category not found")?;

    if child.parent_id != Some(root.id) {
        return Err(format!(
            "Child parent_id mismatch: expected {}, got {:?}",
            root.id, child.parent_id
        ));
    }

    // ── Update ────────────────────────────────────────────────────────────────
    update_product_category(
        ctx,
        org_id,
        child.id,
        UpdateProductCategoryParams {
            name: Some("Notebooks".to_string()),
            parent_id: None,
            sequence: Some(25),
            metadata: None,
        },
    )?;

    let updated = ctx
        .db
        .product_category()
        .id()
        .find(&child.id)
        .ok_or("Category missing after update")?;

    if updated.name != "Notebooks" {
        return Err(format!(
            "Name not updated: expected Notebooks, got {}",
            updated.name
        ));
    }
    if updated.sequence != 25 {
        return Err(format!("Sequence not updated: got {}", updated.sequence));
    }

    // ── Parent validation (missing parent) ────────────────────────────────────
    let bad_parent = update_product_category(
        ctx,
        org_id,
        child.id,
        UpdateProductCategoryParams {
            name: None,
            parent_id: Some(999_999),
            sequence: None,
            metadata: None,
        },
    );
    if bad_parent.is_ok() {
        return Err("Expected error when parent category does not exist".to_string());
    }

    // ── Circular reference ────────────────────────────────────────────────────
    create_product_category(
        ctx,
        org_id,
        CreateProductCategoryParams {
            name: "Level A".to_string(),
            parent_id: None,
            sequence: 30,
            company_id: Some(company_id),
            metadata: None,
        },
    )?;
    let cat_a = ctx
        .db
        .product_category()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Level A")
        .ok_or("Level A not found")?;

    create_product_category(
        ctx,
        org_id,
        CreateProductCategoryParams {
            name: "Level B".to_string(),
            parent_id: Some(cat_a.id),
            sequence: 31,
            company_id: Some(company_id),
            metadata: None,
        },
    )?;
    let cat_b = ctx
        .db
        .product_category()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Level B")
        .ok_or("Level B not found")?;

    let circular = update_product_category(
        ctx,
        org_id,
        cat_a.id,
        UpdateProductCategoryParams {
            name: None,
            parent_id: Some(cat_b.id),
            sequence: None,
            metadata: None,
        },
    );
    if circular.is_ok() {
        return Err("Expected circular reference error".to_string());
    }

    // ── Soft delete + restore ─────────────────────────────────────────────────
    delete_product_category(ctx, org_id, child.id)?;

    let deleted = ctx
        .db
        .product_category()
        .id()
        .find(&child.id)
        .ok_or("Category missing after delete")?;
    if deleted.deleted_at.is_none() {
        return Err("deleted_at should be set after soft delete".to_string());
    }

    restore_product_category(ctx, org_id, child.id)?;

    let restored = ctx
        .db
        .product_category()
        .id()
        .find(&child.id)
        .ok_or("Category missing after restore")?;
    if restored.deleted_at.is_some() {
        return Err("deleted_at should be cleared after restore".to_string());
    }

    Ok(())
}
