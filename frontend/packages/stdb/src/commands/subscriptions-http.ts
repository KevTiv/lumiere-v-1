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
  "close_subscription",
  "create_deferred_revenue_schedule",
  "create_revenue_recognition_rule",
  "create_subscription_from_sale_order",
  "create_subscription_plan",
  "deactivate_revenue_recognition_rule",
  "generate_subscription_invoice",
  "import_subscription_csv",
  "import_subscription_plan_csv",
  "recognize_deferred_revenue",
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
  activate_subscription: ["subscriptions"],
  close_subscription: ["subscriptions"],
  create_deferred_revenue_schedule: [
    "deferred-revenue-schedules",
    "deferred-revenue-lines",
  ],
  create_revenue_recognition_rule: ["revenue-recognition-rules"],
  create_subscription_from_sale_order: ["subscriptions", "subscription-plans"],
  create_subscription_plan: ["subscription-plans"],
  deactivate_revenue_recognition_rule: ["revenue-recognition-rules"],
  generate_subscription_invoice: ["subscriptions"],
  import_subscription_csv: ["subscriptions"],
  import_subscription_plan_csv: ["subscription-plans"],
  recognize_deferred_revenue: [
    "deferred-revenue-lines",
    "deferred-revenue-schedules",
    "account-moves",
    "account-move-lines",
  ],
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
