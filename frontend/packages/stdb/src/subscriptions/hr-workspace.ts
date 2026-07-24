import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * HR list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const HR_WORKSPACE_RESOURCE_KEYS = [
  "contracts",
  "departments",
  // Prefer purpose-scoped employee feeds over org-wide `employees` for default WS mirror.
  "my-employee",
  "direct-reports",
  "employee-documents",
  "job-positions",
  "applicants",
  "leave-requests",
  "leaves-to-approve",
  "leave-types",
  "onboarding-progress",
  "onboarding-template-items",
  "onboarding-templates",
  "performance-cycles",
  "performance-goals",
  "performance-reviews",
  "benefit-plans",
  "benefit-enrollments",
  "payroll-structures",
  "payslips",
  "payslips-to-export",
  "hr-integration-intents",
  "salary-rules",
  "hr-resources",
  "hr-skills",
  "hr-employee-skills",
  "hr-statutory-ids",
  "attendance",
  "compensation-events",
  "work-schedules",
  "labor-cost-snapshots",
  "shift-opt-jobs",
  "global-assignments",
  "hr-capacity-forecast",
] as const;

export type HrWorkspaceResourceKey = (typeof HR_WORKSPACE_RESOURCE_KEYS)[number];

export type HrWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
