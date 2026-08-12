import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Purchasing list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
/**
 * Bounded exception keys (`purchase-orders-to-approve`,
 * `purchase-orders-partial-receipt`, `purchase-order-lines-over-billed`)
 * use server-side `extraWhere` in `ERP_ORG_SQL`.
 */
export const PURCHASING_WORKSPACE_RESOURCE_KEYS = [
  "account-payment-terms",
  "landed-costs",
  "landed-cost-lines",
  "partner-banks",
  "products",
  "purchase-order-lines",
  "purchase-order-lines-over-billed",
  "purchase-orders",
  "purchase-orders-to-approve",
  "purchase-orders-partial-receipt",
  "purchase-requisitions",
  "purchase-requisition-lines",
  "purchase-rfqs",
  "purchase-rfq-lines",
  "purchase-rfq-bids",
  "purchase-returns",
  "purchase-return-lines",
  "purchase-blanket-orders",
  "purchase-blanket-order-lines",
  "purchase-blanket-releases",
  "purchase-contracts",
  "vendor-scorecards",
  "vendor-risk-flags",
  "consignment-agreements",
  "purchase-approval-delegates",
  "commodity-price-indexes",
  "purchasing-integration-intents",
  "supplier-intakes",
  "uoms",
] as const;

export type PurchasingWorkspaceResourceKey =
  (typeof PURCHASING_WORKSPACE_RESOURCE_KEYS)[number];

export type PurchasingWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
