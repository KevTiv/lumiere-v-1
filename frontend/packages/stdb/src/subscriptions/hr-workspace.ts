import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * HR list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const HR_WORKSPACE_RESOURCE_KEYS = [
  "contracts",
  "departments",
  "employees",
  "job-positions",
  "leave-requests",
  "leave-types",
  "payroll-structures",
  "payslips",
  "salary-rules",
  "hr-resources",
  "hr-skills",
  "hr-employee-skills",
] as const;

export type HrWorkspaceResourceKey = (typeof HR_WORKSPACE_RESOURCE_KEYS)[number];

export type HrWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
