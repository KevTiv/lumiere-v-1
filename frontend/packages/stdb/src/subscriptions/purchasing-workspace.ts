import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Purchasing list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
/**
 * Bounded exception keys (`purchase-orders-to-approve`,
 * `purchase-orders-partial-receipt`) use server-side `extraWhere` in `ERP_ORG_SQL`.
 */
export const PURCHASING_WORKSPACE_RESOURCE_KEYS = [
  "account-payment-terms",
  "landed-costs",
  "partner-banks",
  "purchase-order-lines",
  "purchase-orders",
  "purchase-orders-to-approve",
  "purchase-orders-partial-receipt",
  "purchase-requisitions",
  "purchase-rfqs",
  "purchase-rfq-lines",
  "purchase-rfq-bids",
  "purchase-returns",
  "purchase-return-lines",
  "supplier-intakes",
] as const;

export type PurchasingWorkspaceResourceKey =
  (typeof PURCHASING_WORKSPACE_RESOURCE_KEYS)[number];

export type PurchasingWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
