//! Subscription payment and tax intent reducers.

use super::{
    account_move, ensure_collection, grant_default_entitlement, payment_intent_types,
    record_subscription_payment_failure, secs, CreateSubscriptionPaymentIntentParams,
    CreateSubscriptionTaxSettleIntentParams, FailSubscriptionPaymentIntentParams,
    RecordSubscriptionPaymentFailureParams,
};
use super::{
    subscription_collection, subscription_payment_intent, subscription_tax_settle_intent,
    SubscriptionCollection, SubscriptionPaymentIntent, SubscriptionTaxSettleIntent,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::tables::{subscription, Subscription};
use spacetimedb::{ReducerContext, Table};

#[spacetimedb::reducer]
pub fn create_subscription_payment_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: CreateSubscriptionPaymentIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
    let intent_type = params.intent_type.trim().to_ascii_lowercase();
    if !payment_intent_types().contains(&intent_type.as_str()) {
        return Err("intent_type must be card_charge|pix|boleto|paynow|fpx|qris|eft".to_string());
    }
    let key = params.idempotency_key.trim().to_string();
    if key.is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if params.amount <= 0.0 {
        return Err("amount must be > 0".to_string());
    }
    if ctx
        .db
        .subscription_payment_intent()
        .idempotency_key()
        .find(&key)
        .is_some()
    {
        return Ok(());
    }

    // Unreliable card markets: prefer draft_invoice fallback when requested or payment_mode says so.
    let fallback = params.fallback_draft_invoice
        || (intent_type == "card_charge" && sub.payment_mode == "draft_invoice");

    let row = ctx
        .db
        .subscription_payment_intent()
        .insert(SubscriptionPaymentIntent {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            intent_type,
            status: "pending".to_string(),
            idempotency_key: key,
            invoice_move_id: params.invoice_move_id,
            payment_token_id: params.payment_token_id.or(sub.payment_token_id),
            amount: params.amount,
            currency_id: params.currency_id,
            fallback_draft_invoice: fallback,
            last_error: None,
            attempt_count: 0,
            applied_at: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: params.metadata.unwrap_or_default(),
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_payment_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "intent_type": row.intent_type,
                    "fallback_draft_invoice": fallback,
                })
                .to_string(),
            ),
            changed_fields: vec!["intent_type".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn apply_subscription_payment_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let intent = ctx
        .db
        .subscription_payment_intent()
        .id()
        .find(&intent_id)
        .ok_or("Payment intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Intent does not belong to this company".to_string());
    }
    if intent.status == "succeeded" {
        return Ok(());
    }

    // Worker already charged externally; reducer only records success + clears dunning.
    ctx.db
        .subscription_payment_intent()
        .id()
        .update(SubscriptionPaymentIntent {
            status: "succeeded".to_string(),
            applied_at: Some(ctx.timestamp),
            attempt_count: intent.attempt_count.saturating_add(1),
            last_error: None,
            ..intent.clone()
        });

    let sub = require_subscription(ctx, organization_id, company_id, intent.subscription_id)?;
    let _ = grant_default_entitlement(ctx, organization_id, company_id, &sub)?;
    let mut coll = ensure_collection(ctx, organization_id, company_id, intent.subscription_id);
    ctx.db
        .subscription_collection()
        .id()
        .update(SubscriptionCollection {
            stage: "current".to_string(),
            failed_payment_count: 0,
            past_due_days: 0,
            past_due: false,
            last_evaluated_at: ctx.timestamp,
            ..coll
        });
    ctx.db.subscription().id().update(Subscription {
        health: "healthy".to_string(),
        updated_at: ctx.timestamp,
        ..sub
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_payment_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": intent.status }).to_string()),
            new_values: Some(serde_json::json!({ "status": "succeeded" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn fail_subscription_payment_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: FailSubscriptionPaymentIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let intent = ctx
        .db
        .subscription_payment_intent()
        .id()
        .find(&intent_id)
        .ok_or("Payment intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Intent does not belong to this company".to_string());
    }
    ctx.db
        .subscription_payment_intent()
        .id()
        .update(SubscriptionPaymentIntent {
            status: "failed".to_string(),
            last_error: Some(params.last_error.clone()),
            attempt_count: intent.attempt_count.saturating_add(1),
            ..intent.clone()
        });

    if params.record_dunning_failure {
        record_subscription_payment_failure(
            ctx,
            organization_id,
            company_id,
            intent.subscription_id,
            RecordSubscriptionPaymentFailureParams {
                invoice_move_id: intent.invoice_move_id,
                reason: Some(params.last_error),
                past_due_days: None,
            },
        )?;
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_subscription_tax_settle_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: CreateSubscriptionTaxSettleIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let _sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
    let intent_type = params.intent_type.trim().to_ascii_lowercase();
    if intent_type != "wht" && intent_type != "e_invoice" {
        return Err("intent_type must be wht|e_invoice".to_string());
    }
    let key = params.idempotency_key.trim().to_string();
    if key.is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if ctx
        .db
        .subscription_tax_settle_intent()
        .idempotency_key()
        .find(&key)
        .is_some()
    {
        return Ok(());
    }
    let _inv = ctx
        .db
        .account_move()
        .id()
        .find(&params.invoice_move_id)
        .ok_or("Invoice not found")?;

    let row = ctx
        .db
        .subscription_tax_settle_intent()
        .insert(SubscriptionTaxSettleIntent {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            intent_type,
            status: "pending".to_string(),
            idempotency_key: key,
            invoice_move_id: params.invoice_move_id,
            payment_id: params.payment_id,
            pack_code: params.pack_code.trim().to_ascii_lowercase(),
            payload: params.payload,
            last_error: None,
            applied_at: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: params.metadata.unwrap_or_default(),
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_tax_settle_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "intent_type": row.intent_type,
                    "pack_code": row.pack_code,
                })
                .to_string(),
            ),
            changed_fields: vec!["intent_type".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn apply_subscription_tax_settle_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let intent = ctx
        .db
        .subscription_tax_settle_intent()
        .id()
        .find(&intent_id)
        .ok_or("Tax settle intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Intent does not belong to this company".to_string());
    }
    if intent.status == "applied" {
        return Ok(());
    }
    // Worker performed external WHT/e-invoice; stamp move metadata.
    if let Some(mut mv) = ctx.db.account_move().id().find(&intent.invoice_move_id) {
        let mut meta = serde_json::Map::new();
        if let Some(raw) = &mv.metadata {
            if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str(raw) {
                meta = obj;
            }
        }
        meta.insert(
            intent.intent_type.clone(),
            serde_json::json!({
                "pack_code": intent.pack_code,
                "intent_id": intent.id,
                "payment_id": intent.payment_id,
                "applied_at": secs(ctx.timestamp),
            }),
        );
        mv.metadata = Some(serde_json::Value::Object(meta).to_string());
        ctx.db.account_move().id().update(mv);
    }
    ctx.db
        .subscription_tax_settle_intent()
        .id()
        .update(SubscriptionTaxSettleIntent {
            status: "applied".to_string(),
            applied_at: Some(ctx.timestamp),
            ..intent.clone()
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_tax_settle_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": intent.status }).to_string()),
            new_values: Some(serde_json::json!({ "status": "applied" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
