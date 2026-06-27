import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Reports list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const REPORTS_WORKSPACE_RESOURCE_KEYS = [
  "analytics-metrics",
  "dashboards",
  "dashboard-widgets",
  "financial-reports",
  "report-templates",
  "scheduled-reports",
  "trial-balances",
] as const;

export type ReportsWorkspaceResourceKey =
  (typeof REPORTS_WORKSPACE_RESOURCE_KEYS)[number];

export type ReportsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
