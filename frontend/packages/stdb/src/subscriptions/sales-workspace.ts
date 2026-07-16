import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Sales list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 *
 * Bounded exception keys (`sale-orders-to-approve`, `sale-commissions-pending`,
 * `partner-credit-holds`) use server-side `extraWhere` filters in `ERP_ORG_SQL`.
 * Full-table keys remain for Orders / list tabs that need the complete set.
 */
export const SALES_WORKSPACE_RESOURCE_KEYS = [
  "account-payment-terms",
  "delivery-carriers",
  "delivery-price-rules",
  "partner-credit-controls",
  "partner-credit-holds",
  "picking-batches",
  "pos-loyalty-cards",
  "pos-loyalty-programs",
  "pos-payment-methods",
  "pricelist-items",
  "pricelists",
  "sale-order-lines",
  "sale-orders",
  "sale-orders-to-approve",
  "sale-commissions",
  "sale-commissions-pending",
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
