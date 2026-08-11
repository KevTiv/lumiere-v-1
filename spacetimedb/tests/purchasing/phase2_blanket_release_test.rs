//! Persisted proof for bounded, line-bearing, idempotent blanket releases.

use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{organization_settings, OrganizationSettings};
use crate::purchasing::procurement_advanced::{
    create_purchase_blanket_order, purchase_blanket_order, purchase_blanket_order_line,
    purchase_blanket_release, release_blanket_to_po, CreatePurchaseBlanketOrderLineParams,
    CreatePurchaseBlanketOrderParams, ReleaseBlanketLineParams, ReleaseBlanketToPoParams,
};
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line};
use crate::purchasing::PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG;
use crate::test_harness::PurchasingIntegrityFixture;

pub fn test_blanket_release_lines_bounds_and_retry(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let scope = &fixture.primary;
    ctx.db.organization_settings().insert(OrganizationSettings {
        organization_id: scope.organization_id,
        module_config: None,
        feature_flags: vec![PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG.to_string()],
        integration_keys: None,
        updated_at: ctx.timestamp,
        metadata: Some(r#"{"test":"purchasing-phase2-blanket"}"#.to_string()),
    });

    create_purchase_blanket_order(
        ctx,
        scope.organization_id,
        scope.company_id,
        CreatePurchaseBlanketOrderParams {
            name: "Distinctive cartons agreement".to_string(),
            partner_id: scope.vendor_id,
            currency_id: scope.currency_id,
            date_start: None,
            date_end: None,
            lines: vec![CreatePurchaseBlanketOrderLineParams {
                product_id: scope.product_id,
                product_uom: scope.uom_id,
                committed_quantity: 12.5,
                price_unit: 41.75,
                metadata: None,
            }],
            metadata: None,
        },
    )?;
    let blanket = ctx
        .db
        .purchase_blanket_order()
        .iter()
        .find(|row| row.name == "Distinctive cartons agreement")
        .ok_or("blanket order was not persisted")?;
    let line = ctx
        .db
        .purchase_blanket_order_line()
        .purchase_blanket_line_by_blanket()
        .filter(&blanket.id)
        .next()
        .ok_or("blanket line was not persisted")?;

    let release = ReleaseBlanketToPoParams {
        idempotency_key: "blanket-release-distinctive-1".to_string(),
        lines: vec![ReleaseBlanketLineParams {
            blanket_line_id: line.id,
            quantity: 4.25,
        }],
        notes: Some("first bounded release".to_string()),
        date_planned: None,
        metadata: None,
    };
    release_blanket_to_po(
        ctx,
        scope.organization_id,
        scope.company_id,
        blanket.id,
        release.clone(),
    )?;
    release_blanket_to_po(
        ctx,
        scope.organization_id,
        scope.company_id,
        blanket.id,
        release,
    )?;

    let releases: Vec<_> = ctx
        .db
        .purchase_blanket_release()
        .purchase_blanket_release_by_blanket()
        .filter(&blanket.id)
        .collect();
    if releases.len() != 1 {
        return Err("blanket release retry created a duplicate marker".to_string());
    }
    let po = ctx
        .db
        .purchase_order()
        .id()
        .find(&releases[0].purchase_order_id)
        .ok_or("blanket release purchase order missing")?;
    let po_lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po.id)
        .collect();
    if po_lines.len() != 1
        || po_lines[0].product_id != scope.product_id
        || (po_lines[0].product_qty - 4.25).abs() > 0.000_001
        || (po_lines[0].price_unit - 41.75).abs() > 0.000_001
    {
        return Err("blanket release did not create the exact committed PO line".to_string());
    }

    let excessive = release_blanket_to_po(
        ctx,
        scope.organization_id,
        scope.company_id,
        blanket.id,
        ReleaseBlanketToPoParams {
            idempotency_key: "blanket-release-excessive".to_string(),
            lines: vec![ReleaseBlanketLineParams {
                blanket_line_id: line.id,
                quantity: 9.0,
            }],
            notes: None,
            date_planned: None,
            metadata: None,
        },
    );
    if excessive.is_ok() {
        return Err("blanket release exceeded the remaining commitment".to_string());
    }
    Ok(())
}
