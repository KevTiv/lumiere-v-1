//! Persisted proof for bounded, line-bearing, idempotent blanket releases.

use std::time::Duration;

use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::core::organization::{organization_settings, OrganizationSettings};
use crate::purchasing::procurement_advanced::{
    create_purchase_blanket_order, purchase_blanket_order, purchase_blanket_order_line,
    purchase_blanket_release, release_blanket_to_po, CreatePurchaseBlanketOrderLineParams,
    CreatePurchaseBlanketOrderParams, PurchaseBlanketOrder, ReleaseBlanketLineParams,
    ReleaseBlanketToPoParams,
};
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line};
use crate::purchasing::PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG;
use crate::test_harness::{PurchasingIntegrityFixture, PurchasingIntegrityScope};

fn enable_blanket_release(ctx: &ReducerContext, organization_id: u64, metadata: &str) {
    match ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&organization_id)
    {
        Some(settings) => {
            let mut feature_flags = settings.feature_flags.clone();
            if !feature_flags
                .iter()
                .any(|flag| flag == PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG)
            {
                feature_flags.push(PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG.to_string());
            }
            ctx.db
                .organization_settings()
                .organization_id()
                .update(OrganizationSettings {
                    feature_flags,
                    updated_at: ctx.timestamp,
                    ..settings
                });
        }
        None => {
            ctx.db.organization_settings().insert(OrganizationSettings {
                organization_id,
                module_config: None,
                feature_flags: vec![PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG.to_string()],
                integration_keys: None,
                updated_at: ctx.timestamp,
                metadata: Some(metadata.to_string()),
            });
        }
    }
}

fn create_windowed_blanket(
    ctx: &ReducerContext,
    scope: &PurchasingIntegrityScope,
    name: &str,
    date_start: Option<Timestamp>,
    date_end: Option<Timestamp>,
) -> Result<(u64, u64), String> {
    create_purchase_blanket_order(
        ctx,
        scope.organization_id,
        scope.company_id,
        CreatePurchaseBlanketOrderParams {
            name: name.to_string(),
            partner_id: scope.vendor_id,
            currency_id: scope.currency_id,
            date_start,
            date_end,
            lines: vec![CreatePurchaseBlanketOrderLineParams {
                product_id: scope.product_id,
                product_uom: scope.uom_id,
                committed_quantity: 1.0,
                price_unit: 1.0,
                metadata: None,
            }],
            metadata: None,
        },
    )?;
    let blanket = ctx
        .db
        .purchase_blanket_order()
        .iter()
        .find(|row| {
            row.organization_id == scope.organization_id
                && row.company_id == scope.company_id
                && row.name == name
        })
        .ok_or("windowed blanket order was not persisted")?;
    let line = ctx
        .db
        .purchase_blanket_order_line()
        .purchase_blanket_line_by_blanket()
        .filter(&blanket.id)
        .next()
        .ok_or("windowed blanket line was not persisted")?;
    Ok((blanket.id, line.id))
}

pub fn test_blanket_release_effective_window(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let scope = &fixture.primary;
    enable_blanket_release(
        ctx,
        scope.organization_id,
        r#"{"test":"purchasing-phase2-blanket-window"}"#,
    );

    let (inclusive_blanket_id, inclusive_line_id) = create_windowed_blanket(
        ctx,
        scope,
        "Blanket release inclusive window",
        Some(ctx.timestamp),
        Some(ctx.timestamp),
    )?;
    release_blanket_to_po(
        ctx,
        scope.organization_id,
        scope.company_id,
        inclusive_blanket_id,
        ReleaseBlanketToPoParams {
            idempotency_key: "blanket-release-window-inclusive".to_string(),
            lines: vec![ReleaseBlanketLineParams {
                blanket_line_id: inclusive_line_id,
                quantity: 1.0,
            }],
            notes: None,
            date_planned: None,
            metadata: None,
        },
    )?;

    let (future_blanket_id, future_line_id) = create_windowed_blanket(
        ctx,
        scope,
        "Blanket release future window",
        Some(ctx.timestamp + Duration::from_secs(1)),
        Some(ctx.timestamp + Duration::from_secs(2)),
    )?;
    let future_release = release_blanket_to_po(
        ctx,
        scope.organization_id,
        scope.company_id,
        future_blanket_id,
        ReleaseBlanketToPoParams {
            idempotency_key: "blanket-release-window-future".to_string(),
            lines: vec![ReleaseBlanketLineParams {
                blanket_line_id: future_line_id,
                quantity: 1.0,
            }],
            notes: None,
            date_planned: None,
            metadata: None,
        },
    );
    if future_release.as_ref().err().map(String::as_str) != Some("Blanket order is not yet active")
    {
        return Err("blanket release before the effective start was not rejected".to_string());
    }

    let (expired_blanket_id, expired_line_id) = create_windowed_blanket(
        ctx,
        scope,
        "Blanket release expired window",
        Some(ctx.timestamp - Duration::from_secs(2)),
        Some(ctx.timestamp - Duration::from_secs(1)),
    )?;
    let expired_release = release_blanket_to_po(
        ctx,
        scope.organization_id,
        scope.company_id,
        expired_blanket_id,
        ReleaseBlanketToPoParams {
            idempotency_key: "blanket-release-window-expired".to_string(),
            lines: vec![ReleaseBlanketLineParams {
                blanket_line_id: expired_line_id,
                quantity: 1.0,
            }],
            notes: None,
            date_planned: None,
            metadata: None,
        },
    );
    if expired_release.as_ref().err().map(String::as_str) != Some("Blanket order has expired") {
        return Err("blanket release after the effective end was not rejected".to_string());
    }
    Ok(())
}

pub fn test_blanket_release_lines_bounds_and_retry(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let scope = &fixture.primary;
    enable_blanket_release(
        ctx,
        scope.organization_id,
        r#"{"test":"purchasing-phase2-blanket"}"#,
    );

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
        .find(|row| {
            row.organization_id == scope.organization_id
                && row.company_id == scope.company_id
                && row.name == "Distinctive cartons agreement"
        })
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
        release.clone(),
    )?;

    let closed_blanket = ctx
        .db
        .purchase_blanket_order()
        .id()
        .find(&blanket.id)
        .ok_or("blanket order was missing before idempotent retry")?;
    ctx.db
        .purchase_blanket_order()
        .id()
        .update(PurchaseBlanketOrder {
            date_end: Some(ctx.timestamp - Duration::from_secs(1)),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..closed_blanket
        });
    release_blanket_to_po(
        ctx,
        scope.organization_id,
        scope.company_id,
        blanket.id,
        release,
    )?;

    for changed_request in [
        ReleaseBlanketToPoParams {
            idempotency_key: "blanket-release-distinctive-1".to_string(),
            lines: vec![ReleaseBlanketLineParams {
                blanket_line_id: line.id,
                quantity: 4.25,
            }],
            notes: Some("changed release note".to_string()),
            date_planned: None,
            metadata: None,
        },
        ReleaseBlanketToPoParams {
            idempotency_key: "blanket-release-distinctive-1".to_string(),
            lines: vec![ReleaseBlanketLineParams {
                blanket_line_id: line.id,
                quantity: 4.25,
            }],
            notes: Some("first bounded release".to_string()),
            date_planned: Some(ctx.timestamp + Duration::from_secs(60)),
            metadata: None,
        },
        ReleaseBlanketToPoParams {
            idempotency_key: "blanket-release-distinctive-1".to_string(),
            lines: vec![ReleaseBlanketLineParams {
                blanket_line_id: line.id,
                quantity: 4.25,
            }],
            notes: Some("first bounded release".to_string()),
            date_planned: None,
            metadata: Some(r#"{"source":"changed"}"#.to_string()),
        },
    ] {
        let changed = release_blanket_to_po(
            ctx,
            scope.organization_id,
            scope.company_id,
            blanket.id,
            changed_request,
        );
        if changed.as_ref().err().map(String::as_str)
            != Some("Blanket release key was already used with a different request")
        {
            return Err("blanket release retry accepted changed request semantics".to_string());
        }
    }

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
