import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Revenue/subscription list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const SUBSCRIPTIONS_WORKSPACE_RESOURCE_KEYS = [
  "account-move-lines",
  "account-moves",
  "deferred-revenue-lines",
  "deferred-revenue-schedules",
  "revenue-recognition-rules",
  "subscription-plans",
  "subscriptions",
] as const;

export type SubscriptionsWorkspaceResourceKey =
  (typeof SUBSCRIPTIONS_WORKSPACE_RESOURCE_KEYS)[number];

export type SubscriptionsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
