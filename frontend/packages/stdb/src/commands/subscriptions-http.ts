import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Revenue/subscription mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` subscriptions hooks.
 * (Not to be confused with SpacetimeDB subscription workspace resources.)
 */
export const SUBSCRIPTIONS_BFF_REDUCERS = [
  "activate_revenue_recognition_rule",
  "activate_subscription",
  "activate_subscription_plan",
  "add_subscription_bundle_item",
  "advance_subscription_dunning",
  "amend_subscription",
  "apply_index_linked_renewal",
  "apply_subscription_bundle",
  "apply_subscription_payment_intent",
  "apply_subscription_tax_settle_intent",
  "cancel_subscription",
  "close_subscription",
  "create_deferred_revenue_schedule",
  "create_revenue_recognition_rule",
  "create_subscription_bundle",
  "create_subscription_from_sale_order",
  "create_subscription_payment_intent",
  "create_subscription_plan",
  "create_subscription_price_tier",
  "create_subscription_tax_settle_intent",
  "deactivate_revenue_recognition_rule",
  "deactivate_subscription_plan",
  "fail_subscription_payment_intent",
  "generate_subscription_invoice",
  "grant_subscription_entitlement",
  "import_subscription_csv",
  "import_subscription_plan_csv",
  "ingest_subscription_usage_event",
  "pause_subscription",
  "pay_subscription_invoice",
  "rate_subscription_usage_events",
  "rebase_deferred_schedules_for_subscription",
  "recognize_deferred_revenue",
  "record_subscription_payment_failure",
  "refresh_subscription_exception_flags",
  "renew_subscription",
  "resume_subscription",
  "revoke_subscription_entitlement",
  "set_subscription_commitment",
  "update_subscription_plan",
  "upsert_subscription_price_index",
] as const;

export type SubscriptionsBffReducerKey =
  (typeof SUBSCRIPTIONS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<SubscriptionsBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function subscriptionsBffCallUrl(
  reducer: SubscriptionsBffReducerKey,
): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function subscriptionsBffPost(
  reducer: SubscriptionsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: subscriptionsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const SUBSCRIPTIONS_HINT_OVERRIDES: Partial<
  Record<SubscriptionsBffReducerKey, readonly string[]>
> = {
  activate_revenue_recognition_rule: ["revenue-recognition-rules"],
  activate_subscription: ["subscriptions", "subscription-entitlements"],
  activate_subscription_plan: ["subscription-plans"],
  add_subscription_bundle_item: ["subscription-bundle-items", "subscription-bundles"],
  advance_subscription_dunning: [
    "subscriptions",
    "subscription-collections",
    "subscription-entitlements",
    "subscription-past-due",
  ],
  amend_subscription: [
    "subscriptions",
    "subscription-lines",
    "subscription-amendments",
    "account-moves",
  ],
  apply_index_linked_renewal: [
    "subscriptions",
    "subscription-lines",
    "subscription-price-indexes",
    "deferred-revenue-schedules",
  ],
  apply_subscription_bundle: [
    "subscriptions",
    "subscription-lines",
    "subscription-bundles",
  ],
  apply_subscription_payment_intent: [
    "subscription-payment-intents",
    "subscription-collections",
    "subscription-entitlements",
    "subscriptions",
  ],
  apply_subscription_tax_settle_intent: [
    "subscription-tax-settle-intents",
    "account-moves",
  ],
  cancel_subscription: [
    "subscriptions",
    "subscription-amendments",
    "subscription-entitlements",
    "account-moves",
  ],
  close_subscription: ["subscriptions"],
  create_deferred_revenue_schedule: [
    "deferred-revenue-schedules",
    "deferred-revenue-lines",
  ],
  create_revenue_recognition_rule: ["revenue-recognition-rules"],
  create_subscription_bundle: ["subscription-bundles"],
  create_subscription_from_sale_order: ["subscriptions", "subscription-plans"],
  create_subscription_payment_intent: ["subscription-payment-intents"],
  create_subscription_plan: ["subscription-plans"],
  create_subscription_price_tier: ["subscription-price-tiers"],
  create_subscription_tax_settle_intent: ["subscription-tax-settle-intents"],
  deactivate_revenue_recognition_rule: ["revenue-recognition-rules"],
  deactivate_subscription_plan: ["subscription-plans"],
  fail_subscription_payment_intent: [
    "subscription-payment-intents",
    "subscription-collections",
    "subscriptions",
  ],
  generate_subscription_invoice: [
    "subscriptions",
    "subscription-billing-runs",
    "subscription-usage-charges",
    "deferred-revenue-schedules",
    "deferred-revenue-lines",
    "account-moves",
  ],
  grant_subscription_entitlement: ["subscription-entitlements"],
  import_subscription_csv: ["subscriptions"],
  import_subscription_plan_csv: ["subscription-plans"],
  ingest_subscription_usage_event: [
    "subscription-usage-events",
    "subscription-rating-backlog",
  ],
  pause_subscription: ["subscriptions", "subscription-amendments"],
  pay_subscription_invoice: [
    "subscriptions",
    "subscription-collections",
    "subscription-entitlements",
    "account-moves",
    "account-move-lines",
    "account-payments",
  ],
  rate_subscription_usage_events: [
    "subscription-usage-events",
    "subscription-usage-charges",
    "subscription-rating-backlog",
  ],
  rebase_deferred_schedules_for_subscription: [
    "deferred-revenue-schedules",
    "deferred-revenue-lines",
  ],
  recognize_deferred_revenue: [
    "deferred-revenue-lines",
    "deferred-revenue-schedules",
    "account-moves",
    "account-move-lines",
  ],
  record_subscription_payment_failure: [
    "subscription-collections",
    "subscription-past-due",
    "subscriptions",
  ],
  refresh_subscription_exception_flags: [
    "subscription-collections",
    "subscription-due-to-bill",
    "subscription-past-due",
    "subscription-amend-pending",
  ],
  renew_subscription: ["subscriptions", "subscription-amendments"],
  resume_subscription: ["subscriptions", "subscription-amendments"],
  revoke_subscription_entitlement: ["subscription-entitlements"],
  set_subscription_commitment: ["subscription-commitments"],
  update_subscription_plan: ["subscription-plans"],
  upsert_subscription_price_index: ["subscription-price-indexes"],
};

function subscriptionsReducerHints(): Record<
  SubscriptionsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<SubscriptionsBffReducerKey, readonly string[]>;
  for (const k of SUBSCRIPTIONS_BFF_REDUCERS) {
    o[k] = SUBSCRIPTIONS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const SUBSCRIPTIONS_COMMAND_SUBSCRIPTION_HINTS: Record<
  SubscriptionsBffReducerKey,
  readonly string[]
> = subscriptionsReducerHints();

export function subscriptionsCommandContract(
  reducer: SubscriptionsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Subscriptions reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources:
      SUBSCRIPTIONS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
