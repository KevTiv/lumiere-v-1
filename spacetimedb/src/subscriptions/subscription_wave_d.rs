//! Wave D — usage ingest/rating, tier ladders, min commitment true-up, bundles/add-ons.

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line, AccountMove, AccountMoveLine,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::billing_helpers::blank_line;
use crate::subscriptions::tables::{subscription, subscription_line, subscription_plan, Subscription};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Append-only usage meter events (idempotent by org+source+event_id key).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_usage_event,
    public,
    index(accessor = subscription_usage_event_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_usage_event_by_sub, btree(columns = [subscription_id])),
    index(accessor = subscription_usage_event_by_status, btree(columns = [status])),
    index(accessor = subscription_usage_event_by_key, btree(columns = [idempotency_key]))
)]
pub struct SubscriptionUsageEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    /// Meter / worker source (e.g. api, stripe_meter, iot).
    pub source: String,
    /// Caller-provided unique id within source.
    pub event_id: String,
    /// `{org}:{source}:{event_id}` — unique ingest key.
    #[unique]
    pub idempotency_key: String,
    pub product_id: Option<u64>,
    pub quantity: f64,
    pub unit: String,
    pub occurred_at: Timestamp,
    /// pending | rated | ignored
    pub status: String,
    pub rated_charge_id: Option<u64>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: String,
}

/// Rated usage charges awaiting (or attached to) a billing run.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_usage_charge,
    public,
    index(accessor = subscription_usage_charge_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_usage_charge_by_sub, btree(columns = [subscription_id])),
    index(accessor = subscription_usage_charge_by_status, btree(columns = [status])),
    index(accessor = subscription_usage_charge_by_event, btree(columns = [usage_event_id]))
)]
pub struct SubscriptionUsageCharge {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    pub usage_event_id: Option<u64>,
    pub product_id: Option<u64>,
    pub quantity: f64,
    pub unit_price: f64,
    pub amount: f64,
    /// Progressive band summary (e.g. "0-100@1;100-500@0.8").
    pub tier_band: String,
    /// unbilled | billed | true_up
    pub status: String,
    pub invoice_move_id: Option<u64>,
    pub billing_run_key: Option<String>,
    pub description: String,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: String,
}

/// Volume / progressive price ladder on a plan (+ optional product).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_price_tier,
    public,
    index(accessor = subscription_price_tier_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_price_tier_by_plan, btree(columns = [plan_id]))
)]
pub struct SubscriptionPriceTier {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub plan_id: u64,
    pub product_id: Option<u64>,
    pub sequence: u32,
    /// Inclusive lower bound (quantity).
    pub min_qty: f64,
    /// Exclusive upper bound; None = open-ended.
    pub max_qty: Option<f64>,
    pub unit_price: f64,
    pub active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: String,
}

/// Minimum commitment (true-up floor) on a subscription.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_commitment,
    public,
    index(accessor = subscription_commitment_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_commitment_by_sub, btree(columns = [subscription_id]))
)]
pub struct SubscriptionCommitment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    /// Floor amount in subscription currency per billing period.
    pub min_amount: f64,
    /// Optional product filter for usage true-up; None = all usage charges.
    pub product_id: Option<u64>,
    pub active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: String,
}

/// Catalogue bundle template (plan-scoped).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_bundle,
    public,
    index(accessor = subscription_bundle_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_bundle_by_plan, btree(columns = [plan_id]))
)]
pub struct SubscriptionBundle {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub plan_id: u64,
    pub name: String,
    pub code: String,
    pub active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: String,
}

/// Bundle / add-on component lines.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_bundle_item,
    public,
    index(accessor = subscription_bundle_item_by_bundle, btree(columns = [bundle_id])),
    index(accessor = subscription_bundle_item_by_org, btree(columns = [organization_id]))
)]
pub struct SubscriptionBundleItem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub bundle_id: u64,
    pub product_id: u64,
    pub name: String,
    pub quantity: f64,
    pub price_unit: f64,
    pub is_addon: bool,
    pub sequence: u32,
    pub active: bool,
    pub created_at: Timestamp,
    pub metadata: String,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct IngestSubscriptionUsageEventParams {
    pub source: String,
    pub event_id: String,
    pub quantity: f64,
    pub unit: String,
    pub product_id: Option<u64>,
    pub occurred_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RateSubscriptionUsageEventsParams {
    /// Max pending events to rate in this call (cap for WASM).
    pub limit: u32,
    /// Flat fallback unit price when no tiers match.
    pub fallback_unit_price: Option<f64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionPriceTierParams {
    pub plan_id: u64,
    pub product_id: Option<u64>,
    pub sequence: u32,
    pub min_qty: f64,
    pub max_qty: Option<f64>,
    pub unit_price: f64,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetSubscriptionCommitmentParams {
    pub min_amount: f64,
    pub product_id: Option<u64>,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionBundleParams {
    pub plan_id: u64,
    pub name: String,
    pub code: String,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddSubscriptionBundleItemParams {
    pub product_id: u64,
    pub name: String,
    pub quantity: f64,
    pub price_unit: f64,
    pub is_addon: bool,
    pub sequence: u32,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplySubscriptionBundleParams {
    pub bundle_id: u64,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn usage_idempotency_key(organization_id: u64, source: &str, event_id: &str) -> String {
    format!("{organization_id}:{source}:{event_id}")
}

fn load_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
) -> Result<Subscription, String> {
    let sub = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;
    if sub.organization_id != organization_id {
        return Err("Subscription does not belong to this organization".to_string());
    }
    if sub.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }
    Ok(sub)
}

/// Progressive tier rating: units in each band × band price.
/// Tiers are `(min_qty inclusive, max_qty exclusive or None, unit_price)`.
pub(crate) fn rate_quantity_progressive(
    tiers: &[(f64, Option<f64>, f64)],
    quantity: f64,
) -> (f64, f64, String) {
    if quantity <= 0.0 || tiers.is_empty() {
        return (0.0, 0.0, String::new());
    }
    let mut ordered = tiers.to_vec();
    ordered.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut cursor = 0.0f64;
    let mut amount = 0.0f64;
    let mut bands = Vec::new();

    for (min_qty, max_qty, unit_price) in ordered {
        if cursor >= quantity {
            break;
        }
        if cursor < min_qty {
            cursor = min_qty;
        }
        if cursor >= quantity {
            break;
        }
        let end = max_qty.unwrap_or(quantity);
        let band_qty = (end.min(quantity) - cursor).max(0.0);
        if band_qty <= 0.0 {
            continue;
        }
        amount += band_qty * unit_price;
        bands.push(format!("{cursor}-{}@{unit_price}", cursor + band_qty));
        cursor += band_qty;
    }

    if cursor + f64::EPSILON < quantity {
        if let Some((_, _, unit_price)) = tiers
            .iter()
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        {
            let rem = quantity - cursor;
            amount += rem * unit_price;
            bands.push(format!("{cursor}-{quantity}@{unit_price}"));
        }
    }

    let avg = if quantity > 0.0 { amount / quantity } else { 0.0 };
    (amount, avg, bands.join(";"))
}

fn tiers_for_plan_product(
    ctx: &ReducerContext,
    organization_id: u64,
    plan_id: u64,
    product_id: Option<u64>,
) -> Vec<(f64, Option<f64>, f64)> {
    let specific: Vec<(f64, Option<f64>, f64)> = ctx
        .db
        .subscription_price_tier()
        .subscription_price_tier_by_plan()
        .filter(&plan_id)
        .filter(|t| t.organization_id == organization_id && t.active && t.product_id == product_id)
        .map(|t| (t.min_qty, t.max_qty, t.unit_price))
        .collect();
    let mut tiers = if !specific.is_empty() {
        specific
    } else {
        ctx.db
            .subscription_price_tier()
            .subscription_price_tier_by_plan()
            .filter(&plan_id)
            .filter(|t| t.organization_id == organization_id && t.active && t.product_id.is_none())
            .map(|t| (t.min_qty, t.max_qty, t.unit_price))
            .collect()
    };
    tiers.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    tiers
}

pub fn count_unbilled_usage_charges(
    ctx: &ReducerContext,
    organization_id: u64,
    subscription_id: u64,
) -> usize {
    ctx.db
        .subscription_usage_charge()
        .subscription_usage_charge_by_sub()
        .filter(&subscription_id)
        .filter(|c| c.organization_id == organization_id && c.status == "unbilled")
        .count()
}

pub fn count_pending_usage_events(
    ctx: &ReducerContext,
    organization_id: u64,
    subscription_id: u64,
) -> usize {
    ctx.db
        .subscription_usage_event()
        .subscription_usage_event_by_sub()
        .filter(&subscription_id)
        .filter(|e| e.organization_id == organization_id && e.status == "pending")
        .count()
}

/// Append unbilled usage + commitment true-up lines onto an existing draft invoice.
/// Returns total usage/true-up amount added.
pub fn append_unbilled_usage_to_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription: &Subscription,
    move_id: u64,
    income_account_id: u64,
    billing_run_key: &str,
    created_by: Identity,
) -> Result<f64, String> {
    let mut move_row = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice move not found")?;
    if move_row.company_id != company_id {
        return Err("Invoice does not belong to this company".to_string());
    }

    let mut next_seq = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .map(|l| l.sequence)
        .max()
        .unwrap_or(0)
        .saturating_add(1);

    let unbilled: Vec<SubscriptionUsageCharge> = ctx
        .db
        .subscription_usage_charge()
        .subscription_usage_charge_by_sub()
        .filter(&subscription.id)
        .filter(|c| c.organization_id == organization_id && c.status == "unbilled")
        .collect();

    let mut usage_amount = 0.0f64;
    for charge in &unbilled {
        let mut line = blank_line(
            income_account_id,
            if charge.description.is_empty() {
                format!("Usage charge {}", charge.id)
            } else {
                charge.description.clone()
            },
        );
        line.credit = charge.amount;
        line.debit = 0.0;
        line.sequence = next_seq;
        line.quantity = charge.quantity;
        line.price_unit = charge.unit_price;
        line.partner_id = Some(subscription.partner_invoice_id);
        line.product_id = charge.product_id;
        insert_draft_account_move_line(ctx, &move_row, line)?;
        next_seq += 1;
        usage_amount += charge.amount;

        ctx.db
            .subscription_usage_charge()
            .id()
            .update(SubscriptionUsageCharge {
                status: "billed".to_string(),
                invoice_move_id: Some(move_id),
                billing_run_key: Some(billing_run_key.to_string()),
                ..charge.clone()
            });
    }

    // Minimum commitment true-up (floor vs billed usage this run).
    let commitments: Vec<SubscriptionCommitment> = ctx
        .db
        .subscription_commitment()
        .subscription_commitment_by_sub()
        .filter(&subscription.id)
        .filter(|c| c.organization_id == organization_id && c.active)
        .collect();

    let mut true_up_total = 0.0f64;
    for commit in commitments {
        let relevant: f64 = unbilled
            .iter()
            .filter(|c| {
                commit.product_id.is_none() || c.product_id == commit.product_id
            })
            .map(|c| c.amount)
            .sum();
        if commit.min_amount > relevant + f64::EPSILON {
            let gap = commit.min_amount - relevant;
            let desc = format!("Minimum commitment true-up ({})", commit.id);
            let mut line = blank_line(income_account_id, desc.clone());
            line.credit = gap;
            line.debit = 0.0;
            line.sequence = next_seq;
            line.quantity = 1.0;
            line.price_unit = gap;
            line.partner_id = Some(subscription.partner_invoice_id);
            line.product_id = commit.product_id;
            insert_draft_account_move_line(ctx, &move_row, line)?;
            next_seq += 1;
            true_up_total += gap;

            ctx.db.subscription_usage_charge().insert(SubscriptionUsageCharge {
                id: 0,
                organization_id,
                company_id,
                subscription_id: subscription.id,
                usage_event_id: None,
                product_id: commit.product_id,
                quantity: 1.0,
                unit_price: gap,
                amount: gap,
                tier_band: "commitment".to_string(),
                status: "billed".to_string(),
                invoice_move_id: Some(move_id),
                billing_run_key: Some(billing_run_key.to_string()),
                description: desc,
                created_at: ctx.timestamp,
                created_by,
                metadata: serde_json::json!({ "commitment_id": commit.id }).to_string(),
            });
        }
    }

    let added = usage_amount + true_up_total;
    if added <= 0.0 {
        return Ok(0.0);
    }

    // Refresh move totals + bump AR receivable debit.
    move_row = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice move not found after usage lines")?;

    let new_untaxed = move_row.amount_untaxed + added;
    let new_total = move_row.amount_total + added;
    let new_residual = move_row.amount_residual + added;

    // Find receivable line (largest debit) and increase.
    if let Some(ar_line) = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .filter(|l| l.debit > 0.0)
        .max_by(|a, b| a.debit.partial_cmp(&b.debit).unwrap_or(std::cmp::Ordering::Equal))
    {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            debit: ar_line.debit + added,
            price_unit: ar_line.price_unit + added,
            account_internal_type: Some("receivable".to_string()),
            ..ar_line
        });
    }

    ctx.db.account_move().id().update(AccountMove {
        amount_untaxed: new_untaxed,
        amount_total: new_total,
        amount_residual: new_residual,
        amount_untaxed_signed: new_untaxed,
        amount_total_signed: new_total,
        amount_total_in_currency_signed: new_total,
        amount_residual_signed: new_residual,
        write_uid: Some(created_by),
        write_date: Some(ctx.timestamp),
        ..move_row
    });

    Ok(added)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn ingest_subscription_usage_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: IngestSubscriptionUsageEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let _sub = load_subscription(ctx, organization_id, company_id, subscription_id)?;

    let source = params.source.trim().to_string();
    let event_id = params.event_id.trim().to_string();
    if source.is_empty() || event_id.is_empty() {
        return Err("source and event_id are required".to_string());
    }
    if params.quantity <= 0.0 {
        return Err("quantity must be > 0".to_string());
    }

    let key = usage_idempotency_key(organization_id, &source, &event_id);
    if ctx
        .db
        .subscription_usage_event()
        .idempotency_key()
        .find(&key)
        .is_some()
    {
        // Idempotent no-op
        return Ok(());
    }

    let row = ctx.db.subscription_usage_event().insert(SubscriptionUsageEvent {
        id: 0,
        organization_id,
        company_id,
        subscription_id,
        source,
        event_id,
        idempotency_key: key,
        product_id: params.product_id,
        quantity: params.quantity,
        unit: if params.unit.trim().is_empty() {
            "unit".to_string()
        } else {
            params.unit.trim().to_string()
        },
        occurred_at: params.occurred_at.unwrap_or(ctx.timestamp),
        status: "pending".to_string(),
        rated_charge_id: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata.unwrap_or_default(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_usage_event",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "subscription_id": subscription_id,
                    "quantity": params.quantity,
                    "status": "pending",
                })
                .to_string(),
            ),
            changed_fields: vec![
                "subscription_id".to_string(),
                "quantity".to_string(),
                "status".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn rate_subscription_usage_events(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: RateSubscriptionUsageEventsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_subscription(ctx, organization_id, company_id, subscription_id)?;
    let limit = params.limit.clamp(1, 500) as usize;
    let fallback = params.fallback_unit_price.unwrap_or(0.0);

    let pending: Vec<SubscriptionUsageEvent> = ctx
        .db
        .subscription_usage_event()
        .subscription_usage_event_by_sub()
        .filter(&subscription_id)
        .filter(|e| e.organization_id == organization_id && e.status == "pending")
        .take(limit)
        .collect();

    let mut rated = 0u32;
    for event in pending {
        let tiers = tiers_for_plan_product(ctx, organization_id, sub.plan_id, event.product_id);
        let (amount, unit_price, band) = if tiers.is_empty() {
            if fallback <= 0.0 {
                return Err(format!(
                    "no price tiers for plan {} and fallback_unit_price missing for event {}",
                    sub.plan_id, event.id
                ));
            }
            (
                event.quantity * fallback,
                fallback,
                format!("flat@{}", fallback),
            )
        } else {
            let (amt, avg, band) = rate_quantity_progressive(&tiers, event.quantity);
            if amt <= 0.0 && fallback > 0.0 {
                (event.quantity * fallback, fallback, format!("flat@{}", fallback))
            } else {
                (amt, avg, band)
            }
        };

        let charge = ctx.db.subscription_usage_charge().insert(SubscriptionUsageCharge {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            usage_event_id: Some(event.id),
            product_id: event.product_id,
            quantity: event.quantity,
            unit_price,
            amount,
            tier_band: band,
            status: "unbilled".to_string(),
            invoice_move_id: None,
            billing_run_key: None,
            description: format!("Usage {} {}", event.source, event.event_id),
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: serde_json::json!({ "usage_event_id": event.id }).to_string(),
        });

        ctx.db
            .subscription_usage_event()
            .id()
            .update(SubscriptionUsageEvent {
                status: "rated".to_string(),
                rated_charge_id: Some(charge.id),
                ..event
            });
        rated += 1;
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "rated_events": rated }).to_string()),
            changed_fields: vec!["usage_rating".to_string()],
            metadata: Some(
                serde_json::json!({ "rated_events": rated, "limit": limit }).to_string(),
            ),
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_subscription_price_tier(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSubscriptionPriceTierParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&params.plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id {
        return Err("Plan does not belong to this organization".to_string());
    }
    if plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }
    if params.min_qty < 0.0 || params.unit_price < 0.0 {
        return Err("min_qty and unit_price must be >= 0".to_string());
    }
    if let Some(max) = params.max_qty {
        if max <= params.min_qty {
            return Err("max_qty must be > min_qty".to_string());
        }
    }

    let row = ctx.db.subscription_price_tier().insert(SubscriptionPriceTier {
        id: 0,
        organization_id,
        company_id,
        plan_id: params.plan_id,
        product_id: params.product_id,
        sequence: params.sequence,
        min_qty: params.min_qty,
        max_qty: params.max_qty,
        unit_price: params.unit_price,
        active: params.active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata.unwrap_or_default(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_price_tier",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "plan_id": params.plan_id,
                    "min_qty": params.min_qty,
                    "unit_price": params.unit_price,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "plan_id".to_string(),
                "min_qty".to_string(),
                "unit_price".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_subscription_commitment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: SetSubscriptionCommitmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let _sub = load_subscription(ctx, organization_id, company_id, subscription_id)?;
    if params.min_amount < 0.0 {
        return Err("min_amount must be >= 0".to_string());
    }

    // Upsert: deactivate prior active rows for same product filter, insert new.
    let existing: Vec<_> = ctx
        .db
        .subscription_commitment()
        .subscription_commitment_by_sub()
        .filter(&subscription_id)
        .filter(|c| {
            c.organization_id == organization_id
                && c.active
                && c.product_id == params.product_id
        })
        .collect();
    for row in existing {
        ctx.db
            .subscription_commitment()
            .id()
            .update(SubscriptionCommitment {
                active: false,
                updated_at: ctx.timestamp,
                ..row
            });
    }

    let row = ctx.db.subscription_commitment().insert(SubscriptionCommitment {
        id: 0,
        organization_id,
        company_id,
        subscription_id,
        min_amount: params.min_amount,
        product_id: params.product_id,
        active: params.active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata.unwrap_or_default(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_commitment",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "subscription_id": subscription_id,
                    "min_amount": params.min_amount,
                    "active": params.active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "min_amount".to_string(),
                "active".to_string(),
                "subscription_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_subscription_bundle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSubscriptionBundleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&params.plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id || plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }
    let code = params.code.trim().to_string();
    let name = params.name.trim().to_string();
    if code.is_empty() || name.is_empty() {
        return Err("name and code are required".to_string());
    }

    let row = ctx.db.subscription_bundle().insert(SubscriptionBundle {
        id: 0,
        organization_id,
        company_id,
        plan_id: params.plan_id,
        name,
        code,
        active: params.active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata.unwrap_or_default(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_bundle",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "plan_id": params.plan_id, "code": row.code }).to_string(),
            ),
            changed_fields: vec!["plan_id".to_string(), "code".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn add_subscription_bundle_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    bundle_id: u64,
    params: AddSubscriptionBundleItemParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let bundle = ctx
        .db
        .subscription_bundle()
        .id()
        .find(&bundle_id)
        .ok_or("Bundle not found")?;
    if bundle.organization_id != organization_id || bundle.company_id != company_id {
        return Err("Bundle does not belong to this company".to_string());
    }
    if params.quantity <= 0.0 {
        return Err("quantity must be > 0".to_string());
    }

    let row = ctx.db.subscription_bundle_item().insert(SubscriptionBundleItem {
        id: 0,
        organization_id,
        company_id,
        bundle_id,
        product_id: params.product_id,
        name: params.name.trim().to_string(),
        quantity: params.quantity,
        price_unit: params.price_unit,
        is_addon: params.is_addon,
        sequence: params.sequence,
        active: params.active,
        created_at: ctx.timestamp,
        metadata: params.metadata.unwrap_or_default(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_bundle_item",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "bundle_id": bundle_id,
                    "product_id": params.product_id,
                    "quantity": params.quantity,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "bundle_id".to_string(),
                "product_id".to_string(),
                "quantity".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

/// Materialize bundle items as recurring subscription lines (structured add-ons).
#[spacetimedb::reducer]
pub fn apply_subscription_bundle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: ApplySubscriptionBundleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_subscription(ctx, organization_id, company_id, subscription_id)?;
    let bundle = ctx
        .db
        .subscription_bundle()
        .id()
        .find(&params.bundle_id)
        .ok_or("Bundle not found")?;
    if bundle.organization_id != organization_id || bundle.company_id != company_id {
        return Err("Bundle does not belong to this company".to_string());
    }
    if !bundle.active {
        return Err("Bundle is not active".to_string());
    }
    if bundle.plan_id != sub.plan_id {
        return Err("Bundle plan does not match subscription plan".to_string());
    }

    let items: Vec<_> = ctx
        .db
        .subscription_bundle_item()
        .subscription_bundle_item_by_bundle()
        .filter(&params.bundle_id)
        .filter(|i| i.active)
        .collect();
    if items.is_empty() {
        return Err("Bundle has no active items".to_string());
    }

    let mut line_ids = sub.subscription_line_ids.clone();
    let mut created = Vec::new();
    for item in items {
        let subtotal = item.quantity * item.price_unit;
        let line = ctx.db.subscription_line().insert(crate::subscriptions::tables::SubscriptionLine {
            id: 0,
            organization_id,
            name: item.name.clone(),
            subscription_id,
            product_id: item.product_id,
            product_uom: 1,
            product_uom_qty: item.quantity,
            price_unit: item.price_unit,
            price_subtotal: subtotal,
            discount: 0.0,
            price_tax: 0.0,
            price_total: subtotal,
            tax_ids: vec![],
            company_id,
            currency_id: sub.currency_id,
            analytic_account_id: sub.analytic_account_id,
            analytic_tag_ids: vec![],
            recurring_rule_type: sub.recurring_rule_type.clone(),
            recurring_interval: sub.recurring_interval,
            recurring_next_date: sub.recurring_next_date,
            recurring_last_date: None,
            line_is_recurring: true,
            line_is_prorated: false,
            line_is_start_date: false,
            line_is_end_date: false,
            line_is_trial: false,
            line_trial_duration: 0,
            line_trial_unit: "day".to_string(),
            line_parent_id: None,
            line_child_ids: vec![],
            line_is_downpayment: false,
            line_is_discount: false,
            line_is_gift: false,
            line_is_upgrade: false,
            line_is_downgrade: false,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: serde_json::json!({
                "bundle_id": params.bundle_id,
                "bundle_item_id": item.id,
                "is_addon": item.is_addon,
            })
            .to_string(),
        });
        line_ids.push(line.id);
        created.push(line.id);
    }

    ctx.db.subscription().id().update(Subscription {
        subscription_line_ids: line_ids,
        updated_at: ctx.timestamp,
        ..sub
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "bundle_id": params.bundle_id,
                    "line_ids": created,
                })
                .to_string(),
            ),
            changed_fields: vec!["subscription_line_ids".to_string()],
            metadata: Some(
                serde_json::json!({ "applied_bundle_id": params.bundle_id }).to_string(),
            ),
        },
    );
    Ok(())
}

#[cfg(test)]
mod progressive_tests {
    use super::rate_quantity_progressive;

    #[test]
    fn progressive_two_bands() {
        let tiers = vec![(0.0, Some(100.0), 1.0), (100.0, None, 0.5)];
        let (amount, _, band) = rate_quantity_progressive(&tiers, 150.0);
        assert!((amount - 125.0).abs() < 1e-6, "got {amount} band={band}");
    }
}
