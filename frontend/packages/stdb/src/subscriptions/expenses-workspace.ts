import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Expenses list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const EXPENSES_WORKSPACE_RESOURCE_KEYS = [
  "expenses",
  "expense-sheets",
] as const;

export type ExpensesWorkspaceResourceKey =
  (typeof EXPENSES_WORKSPACE_RESOURCE_KEYS)[number];

export type ExpensesWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
