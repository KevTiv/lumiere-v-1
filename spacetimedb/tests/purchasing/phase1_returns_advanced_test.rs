//! Persisted Phase 1 proof for purchase returns, vendor credits, and integration intents.

use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::organization::{organization_settings, OrganizationSettings};
use crate::purchasing::procurement_advanced::{
    create_consignment_agreement, create_purchasing_integration_intent,
    purchasing_integration_intent, record_purchasing_integration_result,
    CreateConsignmentAgreementParams, CreatePurchasingIntegrationIntentParams,
    RecordPurchasingIntegrationResultParams,
};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, confirm_purchase_order, create_purchase_order, purchase_order,
    purchase_order_line, receive_po_line, AddPurchaseOrderLineParams, CreatePurchaseOrderParams,
};
use crate::purchasing::purchase_returns::{
    confirm_purchase_return, create_purchase_return, create_vendor_credit_from_purchase_return,
    purchase_return, CreatePurchaseReturnLineParams, CreatePurchaseReturnParams,
    CreateVendorCreditFromPurchaseReturnParams,
};
use crate::purchasing::PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG;
use crate::test_harness::{PurchasingIntegrityFixture, PurchasingIntegrityScope};

fn enable_phase1_actions(ctx: &ReducerContext, scope: &PurchasingIntegrityScope) {
    match ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&scope.organization_id)
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
                organization_id: scope.organization_id,
                module_config: None,
                feature_flags: vec![PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG.to_string()],
                integration_keys: None,
                updated_at: ctx.timestamp,
                metadata: Some(r#"{"test":"purchasing-phase1"}"#.to_string()),
            });
        }
    }
}

pub fn test_phase1_returns_credits_and_integrations(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let scope = &fixture.primary;
    enable_phase1_actions(ctx, scope);

    let origin = format!("phase1-return-{}", scope.company_id);
    create_purchase_order(
        ctx,
        scope.organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(scope.company_id),
            partner_id: scope.vendor_id,
            currency_id: scope.currency_id,
            origin: Some(origin.clone()),
            partner_ref: None,
            notes: None,
            date_planned: Some(ctx.timestamp),
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: Some(r#"{"test":"phase1-return-source"}"#.to_string()),
        },
    )?;
    let order = ctx
        .db
        .purchase_order()
        .iter()
        .find(|order| {
            order.organization_id == scope.organization_id
                && order.company_id == scope.company_id
                && order.origin.as_deref() == Some(origin.as_str())
        })
        .ok_or("Phase 1 source PO not found")?;
    add_purchase_order_line(
        ctx,
        scope.organization_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: scope.product_id,
            quantity: 5.0,
            uom_id: scope.uom_id,
            price_unit: 37.25,
            discount: 0.0,
            tax_ids: vec![],
            name: Some("distinctive received cartons".to_string()),
            sequence: Some(17),
            display_type: None,
            product_variant_id: None,
            account_analytic_id: None,
            date_planned: Some(ctx.timestamp),
            propagate_cancel: Some(true),
            lot_id: None,
            metadata: None,
        },
    )?;
    let line = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("Phase 1 source PO line not found")?;
    confirm_purchase_order(ctx, scope.organization_id, order.id)?;
    receive_po_line(ctx, scope.organization_id, line.id, 2.0, None)?;

    let substitution = create_purchase_return(
        ctx,
        scope.organization_id,
        scope.company_id,
        CreatePurchaseReturnParams {
            purchase_order_id: Some(order.id),
            partner_id: scope.vendor_id,
            return_reason: Some("substitution rejection".to_string()),
            lines: vec![CreatePurchaseReturnLineParams {
                purchase_order_line_id: Some(line.id),
                product_id: fixture.foreign.product_id,
                product_uom: scope.uom_id,
                product_uom_qty: 1.0,
                price_unit: 37.25,
                to_refund: true,
            }],
        },
    );
    if substitution.is_ok() {
        return Err("Sourced return accepted a substituted foreign product".to_string());
    }

    let excessive = create_purchase_return(
        ctx,
        scope.organization_id,
        scope.company_id,
        CreatePurchaseReturnParams {
            purchase_order_id: Some(order.id),
            partner_id: scope.vendor_id,
            return_reason: Some("quantity rejection".to_string()),
            lines: vec![CreatePurchaseReturnLineParams {
                purchase_order_line_id: Some(line.id),
                product_id: scope.product_id,
                product_uom: scope.uom_id,
                product_uom_qty: 3.0,
                price_unit: 37.25,
                to_refund: true,
            }],
        },
    );
    if excessive.is_ok() {
        return Err("Sourced return exceeded the received quantity".to_string());
    }

    create_purchase_return(
        ctx,
        scope.organization_id,
        scope.company_id,
        CreatePurchaseReturnParams {
            purchase_order_id: Some(order.id),
            partner_id: scope.vendor_id,
            return_reason: Some("damaged cartons".to_string()),
            lines: vec![CreatePurchaseReturnLineParams {
                purchase_order_line_id: Some(line.id),
                product_id: scope.product_id,
                product_uom: scope.uom_id,
                product_uom_qty: 2.0,
                price_unit: 37.25,
                to_refund: true,
            }],
        },
    )?;
    let purchase_return = ctx
        .db
        .purchase_return()
        .iter()
        .find(|record| {
            record.organization_id == scope.organization_id
                && record.purchase_order_id == Some(order.id)
                && record.return_reason.as_deref() == Some("damaged cartons")
        })
        .ok_or("Phase 1 purchase return not found")?;
    confirm_purchase_return(
        ctx,
        scope.organization_id,
        scope.company_id,
        purchase_return.id,
    )?;

    let credit_params = CreateVendorCreditFromPurchaseReturnParams {
        journal_id: scope.journal_id,
        expense_account_id: scope.expense_account_id,
        payable_account_id: scope.payable_account_id,
        metadata: Some(r#"{"test":"phase1-vendor-credit"}"#.to_string()),
    };
    create_vendor_credit_from_purchase_return(
        ctx,
        scope.organization_id,
        scope.company_id,
        purchase_return.id,
        credit_params.clone(),
    )?;
    let credited = ctx
        .db
        .purchase_return()
        .id()
        .find(&purchase_return.id)
        .ok_or("Credited purchase return missing")?;
    let move_id = credited
        .credit_move_id
        .ok_or("Vendor credit was not linked")?;
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    let debit: f64 = lines.iter().map(|line| line.debit).sum();
    let credit: f64 = lines.iter().map(|line| line.credit).sum();
    if lines.len() != 2 || (debit - credit).abs() > 0.000_001 {
        return Err("Vendor credit lines are not exactly balanced".to_string());
    }
    let move_count_before = ctx
        .db
        .account_move()
        .iter()
        .filter(|record| {
            record.invoice_origin.as_deref() == Some(&format!("VRMA{}", purchase_return.id))
        })
        .count();
    create_vendor_credit_from_purchase_return(
        ctx,
        scope.organization_id,
        scope.company_id,
        purchase_return.id,
        credit_params,
    )?;
    let move_count_after = ctx
        .db
        .account_move()
        .iter()
        .filter(|record| {
            record.invoice_origin.as_deref() == Some(&format!("VRMA{}", purchase_return.id))
        })
        .count();
    if move_count_before != 1 || move_count_after != 1 {
        return Err("Vendor-credit retry created a duplicate move".to_string());
    }

    let cross_company_consignment = create_consignment_agreement(
        ctx,
        scope.organization_id,
        fixture.cross_company_id,
        CreateConsignmentAgreementParams {
            name: "cross-company-consignment".to_string(),
            partner_id: scope.vendor_id,
            product_id: scope.product_id,
            warehouse_id: scope.warehouse_id,
            metadata: None,
        },
    );
    if cross_company_consignment.is_ok() {
        return Err("Advanced procurement accepted cross-company relations".to_string());
    }

    let intent_params = CreatePurchasingIntegrationIntentParams {
        provider: "DistinctiveProvider".to_string(),
        intent_type: "VendorCreditExport".to_string(),
        purchase_order_id: Some(order.id),
        idempotency_key: format!("phase1:{}:{}", scope.company_id, order.id),
        request_payload: Some(r#"{"credit":"distinctive"}"#.to_string()),
        metadata: None,
    };
    create_purchasing_integration_intent(
        ctx,
        scope.organization_id,
        scope.company_id,
        intent_params.clone(),
    )?;
    create_purchasing_integration_intent(
        ctx,
        scope.organization_id,
        scope.company_id,
        intent_params.clone(),
    )?;
    let intents: Vec<_> = ctx
        .db
        .purchasing_integration_intent()
        .iter()
        .filter(|intent| {
            intent.organization_id == scope.organization_id
                && intent.company_id == scope.company_id
                && intent.idempotency_key == intent_params.idempotency_key
        })
        .collect();
    if intents.len() != 1 {
        return Err("Integration-intent retry did not preserve one durable row".to_string());
    }
    let mut conflicting = intent_params;
    conflicting.request_payload = Some(r#"{"credit":"changed"}"#.to_string());
    if create_purchasing_integration_intent(
        ctx,
        scope.organization_id,
        scope.company_id,
        conflicting,
    )
    .is_ok()
    {
        return Err("Integration idempotency tuple accepted a conflicting payload".to_string());
    }
    record_purchasing_integration_result(
        ctx,
        scope.organization_id,
        scope.company_id,
        intents[0].id,
        RecordPurchasingIntegrationResultParams {
            status: "succeeded".to_string(),
            external_reference: Some("EXT-PHASE1-947".to_string()),
            last_error: None,
            metadata: None,
        },
    )?;
    if record_purchasing_integration_result(
        ctx,
        scope.organization_id,
        scope.company_id,
        intents[0].id,
        RecordPurchasingIntegrationResultParams {
            status: "failed".to_string(),
            external_reference: None,
            last_error: Some("late failure".to_string()),
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("Terminal integration intent accepted an illegal transition".to_string());
    }

    Ok(())
}
