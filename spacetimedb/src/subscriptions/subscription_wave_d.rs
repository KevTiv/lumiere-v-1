//! Wave D — usage ingest/rating, tier ladders, min commitment true-up, bundles/add-ons.

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line, AccountMove, AccountMoveLine,
};
use crate::accounting::line_params::blank_journal_line;
use crate::subscriptions::tables::Subscription;

#[path = "subscription_usage.rs"]
mod subscription_usage;
pub use subscription_usage::*;
#[path = "subscription_pricing.rs"]
mod subscription_pricing;
pub use subscription_pricing::*;
#[path = "subscription_bundles.rs"]
mod subscription_bundles;
pub use subscription_bundles::*;

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

    let avg = if quantity > 0.0 {
        amount / quantity
    } else {
        0.0
    };
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
        let mut line = blank_journal_line(
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
            .filter(|c| commit.product_id.is_none() || c.product_id == commit.product_id)
            .map(|c| c.amount)
            .sum();
        if commit.min_amount > relevant + f64::EPSILON {
            let gap = commit.min_amount - relevant;
            let desc = format!("Minimum commitment true-up ({})", commit.id);
            let mut line = blank_journal_line(income_account_id, desc.clone());
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

            ctx.db
                .subscription_usage_charge()
                .insert(SubscriptionUsageCharge {
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
        .max_by(|a, b| {
            a.debit
                .partial_cmp(&b.debit)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
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
