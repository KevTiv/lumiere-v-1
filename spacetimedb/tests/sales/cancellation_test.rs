//! SAL-003: negative test matrix for `cancel_sale_order` — asserts invalid state
//! transitions are rejected with `Err` and leave the sale order row unmutated.
use spacetimedb::{ReducerContext, Table};

use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    cancel_sale_order, confirm_sales_order, create_sale_order, sale_order,
    CreateSaleOrderLineParams, CreateSaleOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, InvoiceStatus, SaleState};

/// Seed a minimal draft sale order in `fixture`'s org/company and return its id.
fn seed_so(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    pricelist_name: &str,
    client_ref: &str,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            company_id: None,
            name: pricelist_name.to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == pricelist_name)
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_sale_order(
        ctx,
        org_id,
        CreateSaleOrderParams {
            company_id: Some(fixture.company_id),
            partner_id: fixture.partner_id,
            partner_invoice_id: fixture.partner_id,
            partner_shipping_id: fixture.partner_id,
            pricelist_id,
            currency_id: 1,
            warehouse_id: fixture.warehouse_id,
            order_lines: vec![CreateSaleOrderLineParams {
                product_id: fixture.product_id,
                quantity: 1.0,
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
                customer_lead: None,
                metadata: None,
            }],
            origin: Some(client_ref.to_string()),
            client_order_ref: Some(client_ref.to_string()),
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
            customer_lead: None,
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
            metadata: None,
        },
    )?;

    ctx.db
        .sale_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.client_order_ref.as_deref() == Some(client_ref))
        .map(|o| o.id)
        .ok_or("Sale order not found after create".to_string())
}

/// A `Done` sale order can never be cancelled — no reducer in this codebase currently
/// drives an order to `Done`, so the precondition is set up via a direct row mutation
/// (matching the established pattern in `tests/inventory/tests/relational_integrity_test.rs`)
/// purely to exercise the guard in `cancel_sale_order`.
pub fn test_cancel_done_order_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = seed_so(ctx, &fixture, "SAL003 Done PL", "SAL003-DONE")?;

    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order missing before mutation")?;
    ctx.db.sale_order().id().update(crate::sales::sales_core::SaleOrder {
        state: SaleState::Done,
        ..order
    });

    match cancel_sale_order(ctx, org_id, order_id, Some("attempt cancel done".to_string())) {
        Ok(()) => Err("Expected cancel of a Done order to be rejected".to_string()),
        Err(e) if e.contains("Cannot cancel a done order") => {
            let after = ctx
                .db
                .sale_order()
                .id()
                .find(&order_id)
                .ok_or("Sale order missing after rejected cancel")?;
            if after.state != SaleState::Done {
                return Err(format!(
                    "Expected state to remain Done after rejected cancel, got {:?}",
                    after.state
                ));
            }
            Ok(())
        }
        Err(e) => Err(format!("Unexpected cancel error: {e}")),
    }
}

/// An invoiced sale order must be cancelled via credit note / return, not directly.
/// `invoice_status` is forced via a direct row mutation to isolate the guard from the
/// heavyweight `create_invoice_from_sale_order` flow (covered elsewhere).
pub fn test_cancel_invoiced_order_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = seed_so(ctx, &fixture, "SAL003 Invoiced PL", "SAL003-INVOICED")?;

    confirm_sales_order(ctx, org_id, fixture.company_id, order_id)?;

    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order missing before mutation")?;
    ctx.db.sale_order().id().update(crate::sales::sales_core::SaleOrder {
        invoice_status: InvoiceStatus::Invoiced,
        ..order
    });

    match cancel_sale_order(
        ctx,
        org_id,
        order_id,
        Some("attempt cancel invoiced".to_string()),
    ) {
        Ok(()) => Err("Expected cancel of an invoiced order to be rejected".to_string()),
        Err(e) if e.contains("invoiced") => {
            let after = ctx
                .db
                .sale_order()
                .id()
                .find(&order_id)
                .ok_or("Sale order missing after rejected cancel")?;
            if after.state == SaleState::Cancelled {
                return Err("Expected state NOT to become Cancelled after rejected cancel".to_string());
            }
            if after.invoice_status != InvoiceStatus::Invoiced {
                return Err(format!(
                    "Expected invoice_status to remain Invoiced, got {:?}",
                    after.invoice_status
                ));
            }
            Ok(())
        }
        Err(e) => Err(format!("Unexpected cancel error: {e}")),
    }
}

/// Cross-org cancellation must be rejected by `validate_order_org_scope`: an order from
/// org A cannot be cancelled by passing org B's id, even though both orgs are real rows.
pub fn test_cancel_cross_org_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let org_a = fixture_a.organization_id;
    let org_b = fixture_b.organization_id;

    let order_id = seed_so(ctx, &fixture_a, "SAL003 CrossOrg PL", "SAL003-CROSSORG")?;

    match cancel_sale_order(ctx, org_b, order_id, Some("cross-org attempt".to_string())) {
        Ok(()) => Err("Expected cross-org cancel to be rejected".to_string()),
        Err(e) if e.contains("does not belong to this organization") => {
            let after = ctx
                .db
                .sale_order()
                .id()
                .find(&order_id)
                .ok_or("Sale order missing after rejected cross-org cancel")?;
            if after.state == SaleState::Cancelled {
                return Err(
                    "Expected state NOT to become Cancelled after rejected cross-org cancel"
                        .to_string(),
                );
            }
            if after.organization_id != org_a {
                return Err("Sale order organization_id must not change".to_string());
            }
            Ok(())
        }
        Err(e) => Err(format!("Unexpected cancel error: {e}")),
    }
}

/// Cancelling a nonexistent order id must fail closed rather than silently no-op.
/// The id is derived from a real order id (never a hardcoded magic number) plus a large
/// offset, and its absence is verified before the call.
pub fn test_cancel_nonexistent_order_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let real_order_id = seed_so(ctx, &fixture, "SAL003 NotFound PL", "SAL003-NOTFOUND")?;

    let missing_id = real_order_id + 1_000_000;
    if ctx.db.sale_order().id().find(&missing_id).is_some() {
        return Err("Expected missing_id to not correspond to any real sale order".to_string());
    }

    match cancel_sale_order(ctx, org_id, missing_id, None) {
        Ok(()) => Err("Expected cancel of a nonexistent order to be rejected".to_string()),
        Err(e) if e.contains("Sale order not found") => {
            if ctx.db.sale_order().id().find(&missing_id).is_some() {
                return Err("A sale order row must not be created by a failed cancel".to_string());
            }
            let real_order = ctx
                .db
                .sale_order()
                .id()
                .find(&real_order_id)
                .ok_or("Real sale order missing after unrelated failed cancel")?;
            if real_order.state == SaleState::Cancelled {
                return Err("Unrelated real sale order must not be mutated".to_string());
            }
            Ok(())
        }
        Err(e) => Err(format!("Unexpected cancel error: {e}")),
    }
}
