import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Sales list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const SALES_WORKSPACE_RESOURCE_KEYS = [
  "account-payment-terms",
  "delivery-carriers",
  "delivery-price-rules",
  "partner-credit-controls",
  "picking-batches",
  "pos-loyalty-cards",
  "pos-loyalty-programs",
  "pos-payment-methods",
  "pricelist-items",
  "pricelists",
  "sale-order-lines",
  "sale-orders",
  "sale-commissions",
  "return-orders",
  "return-order-lines",
  "shipping-methods",
  "stock-pickings",
] as const;

export type SalesWorkspaceResourceKey =
  (typeof SALES_WORKSPACE_RESOURCE_KEYS)[number];

export type SalesWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
