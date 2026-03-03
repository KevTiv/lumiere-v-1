//! Phase 9 – Billing & Subscriptions
//!
//! - `SubscriptionPlan` reusable price templates
//! - `Subscription` recurring-contract header
//! - `SubscriptionLine` recurring-contract lines
//! - `DeferredRevenueSchedule` & `DeferredRevenueLine` for automatic revenue recognition
//! - `RevenueRecognitionRule` to decide *when* a SO line should be deferred
//!
//! Public helpers:
//! - `create_subscription_from_sale_order` – turn a confirmed SO into a subscription
//! - `generate_subscription_invoice` – create next recurring invoice
//! - `recognize_deferred_revenue` – move amounts from deferred → income

pub mod reducers;
pub mod tables;

pub use reducers::*;
pub use tables::*;
