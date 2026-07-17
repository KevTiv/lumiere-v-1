import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Expenses list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
/**
 * Bounded exception keys (`expense-sheets-to-approve`, `expenses-missing-receipt`)
 * mirror purchasing-style approval/exception queues.
 */
export const EXPENSES_WORKSPACE_RESOURCE_KEYS = [
  "expenses",
  "expense-sheets",
  "expense-sheets-to-approve",
  "expenses-missing-receipt",
  "expense-card-statement-unmatched",
] as const;

export type ExpensesWorkspaceResourceKey =
  (typeof EXPENSES_WORKSPACE_RESOURCE_KEYS)[number];

export type ExpensesWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
