/// Inventory product update/delete domain tests — in-module test helpers.
use spacetimedb::ReducerContext;

use crate::core::audit::audit_log;
use crate::inventory::product::{delete_product, product, update_product, UpdateProductParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_product_update_and_delete(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let product_id = fixture.product_id;

    update_product(
        ctx,
        org_id,
        product_id,
        UpdateProductParams {
            name: Some("Harness Updated Product".to_string()),
            categ_id: None,
            standard_price: None,
            list_price: None,
            description: None,
            sale_ok: None,
            purchase_ok: None,
            active: None,
            is_published: None,
        },
    )?;

    let updated = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product missing after update")?;

    if updated.name != "Harness Updated Product" {
        return Err(format!(
            "Name not updated: expected Harness Updated Product, got {}",
            updated.name
        ));
    }
    if updated.display_name != Some("Harness Updated Product".to_string()) {
        return Err("display_name should mirror name after update".to_string());
    }

    let has_update_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "product"
                && entry.record_id == product_id
                && entry.action == "UPDATE"
        });
    if !has_update_audit {
        return Err("Expected UPDATE audit row for product".to_string());
    }

    delete_product(ctx, org_id, product_id)?;

    let deleted = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product row missing after delete")?;

    if deleted.active {
        return Err("active should be false after soft delete".to_string());
    }

    let has_delete_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "product"
                && entry.record_id == product_id
                && entry.action == "DELETE"
        });
    if !has_delete_audit {
        return Err("Expected DELETE audit row for product".to_string());
    }

    Ok(())
}
