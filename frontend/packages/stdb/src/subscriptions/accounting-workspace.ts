import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Accounting list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const ACCOUNTING_WORKSPACE_RESOURCE_KEYS = [
  "account-account-types",
  "account-accounts",
  "account-groups",
  "account-journals",
  "account-move-lines",
  "account-moves",
  "account-payment-term-lines",
  "account-payment-terms",
  "account-payments",
  "account-periods",
  "account-reconciliation-widgets",
  "account-taxes",
  "analytic-accounts",
  "analytic-distribution-models",
  "analytic-lines",
  "bank-match-candidates",
  "bank-statement-lines",
  "bank-statements",
  "budget-lines",
  "budget-posts",
  "budgets",
  "consolidation-accounts",
  "consolidation-elimination-entries",
  "consolidation-journals",
  "depreciation-lines",
  "fiscal-years",
  "fixed-assets",
  "intercompany-rules",
  "intercompany-transactions",
  "sale-orders",
  "contacts",
  "tax-deadlines",
  "tax-groups",
  "tax-jurisdictions",
  "tax-schedules",
] as const;

export type AccountingWorkspaceResourceKey =
  (typeof ACCOUNTING_WORKSPACE_RESOURCE_KEYS)[number];

export type AccountingWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
