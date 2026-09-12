//! Scoped relational loaders shared by subscription mutation reducers.

use spacetimedb::ReducerContext;

use crate::subscriptions::tables::{subscription, Subscription};

/// Load a subscription, validating that it belongs to the given organization
/// and company.
///
/// Error text and return type match the former per-wave `load_subscription` /
/// `load_sub` copies exactly.
pub(crate) fn require_subscription(
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
