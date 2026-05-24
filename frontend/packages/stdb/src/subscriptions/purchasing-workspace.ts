import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Purchasing list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const PURCHASING_WORKSPACE_RESOURCE_KEYS = [
  "landed-costs",
  "partner-banks",
  "purchase-order-lines",
  "purchase-orders",
  "purchase-requisitions",
  "supplier-intakes",
] as const;

export type PurchasingWorkspaceResourceKey =
  (typeof PURCHASING_WORKSPACE_RESOURCE_KEYS)[number];

export type PurchasingWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
