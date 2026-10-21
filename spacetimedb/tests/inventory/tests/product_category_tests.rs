/// Product category domain tests — in-module test helpers.
///
/// Invoked from [`super::run_all_inventory_tests`]; requires SpacetimeDB runtime + superuser.
use spacetimedb::{ReducerContext, Table};

use crate::core::persistence::{organization_commit, organization_row_change};
use crate::data_ops::inventory_imports::import_product_category_csv;
use crate::inventory::product_category::{
    create_product_category, delete_product_category, product_category, restore_product_category,
    update_product_category, CreateProductCategoryParams, ProductCategory,
    UpdateProductCategoryParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_product_category_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let before_create = commit_count(ctx, org_id);

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
    assert_effects(
        ctx,
        org_id,
        before_create,
        "erp.create_product_category",
        &[root.clone()],
    )?;

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
    let before_update = commit_count(ctx, org_id);
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
    assert_effects(
        ctx,
        org_id,
        before_update,
        "erp.update_product_category",
        &[updated],
    )?;

    // ── Parent validation (missing parent) ────────────────────────────────────
    let before_rejected = commit_count(ctx, org_id);
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
    if commit_count(ctx, org_id) != before_rejected {
        return Err("Rejected category update recorded a commit".into());
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
    let before_delete = commit_count(ctx, org_id);
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
    assert_effects(
        ctx,
        org_id,
        before_delete,
        "erp.delete_product_category",
        &[deleted],
    )?;
    let before_duplicate_delete = commit_count(ctx, org_id);
    delete_product_category(ctx, org_id, child.id)?;
    if commit_count(ctx, org_id) != before_duplicate_delete {
        return Err("Idempotent category deletion recorded another commit".into());
    }

    let before_restore = commit_count(ctx, org_id);
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
    assert_effects(
        ctx,
        org_id,
        before_restore,
        "erp.restore_product_category",
        &[restored],
    )?;
    let before_duplicate_restore = commit_count(ctx, org_id);
    restore_product_category(ctx, org_id, child.id)?;
    if commit_count(ctx, org_id) != before_duplicate_restore {
        return Err("Idempotent category restoration recorded another commit".into());
    }

    // A partial CSV import records successful rows together, in insertion order.
    let before_import = commit_count(ctx, org_id);
    import_product_category_csv(
        ctx,
        org_id,
        "name,sequence\nFeed A,40\n,41\nFeed B,42".into(),
    )?;
    let mut imported: Vec<_> = ctx
        .db
        .product_category()
        .iter()
        .filter(|row| {
            row.organization_id == org_id && (row.name == "Feed A" || row.name == "Feed B")
        })
        .collect();
    imported.sort_by_key(|row| row.id);
    if imported.len() != 2 {
        return Err("Category CSV fixture did not import two successful rows".into());
    }
    assert_effects(
        ctx,
        org_id,
        before_import,
        "erp.import_product_category_csv",
        &imported,
    )?;

    Ok(())
}

fn commit_count(ctx: &ReducerContext, organization_id: u64) -> usize {
    ctx.db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&organization_id)
        .count()
}

/// Assert the actual persisted full rows, not a hand-built approximation of the feed.
fn assert_effects(
    ctx: &ReducerContext,
    organization_id: u64,
    before: usize,
    operation: &str,
    rows: &[ProductCategory],
) -> Result<(), String> {
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&organization_id)
        .collect();
    if commits.len() != before + 1 {
        return Err(format!("{operation} must record exactly one commit"));
    }
    let commit = commits
        .iter()
        .max_by_key(|commit| commit.sequence)
        .ok_or("Category commit missing")?;
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&organization_id)
        .filter(|change| change.commit_sequence == commit.sequence)
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    if commit.operation_id != operation
        || commit.row_change_count as usize != rows.len()
        || changes.len() != rows.len()
    {
        return Err(format!("{operation} commit envelope mismatch"));
    }
    for (ordinal, (change, row)) in changes.iter().zip(rows).enumerate() {
        let expected = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(row))
            .map_err(|error| error.to_string())?;
        let actual: serde_json::Value = serde_json::from_str(
            change
                .row_json
                .as_deref()
                .ok_or("Category effect row missing")?,
        )
        .map_err(|error| error.to_string())?;
        if change.ordinal as usize != ordinal
            || change.organization_id != organization_id
            || change.table_name != "product_category"
            || change.change_kind != "upsert"
            || change.row_identity_json != format!(r#"{{"id":{}}}"#, row.id)
            || actual != expected
        {
            return Err(format!(
                "{operation} did not persist the exact category effect at ordinal {ordinal}"
            ));
        }
    }
    Ok(())
}
