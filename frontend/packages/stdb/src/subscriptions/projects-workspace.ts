import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Projects list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 *
 * Bounded ops-inbox keys (`timesheets-to-validate`, `timesheets-unbilled`) mirror
 * expenses/sales approval queues.
 */
export const PROJECTS_WORKSPACE_RESOURCE_KEYS = [
  "projects",
  "tasks",
  "timesheets",
  "timesheets-to-validate",
  "timesheets-unbilled",
  "project-rate-cards",
  "project-rate-card-lines",
  "working-calendars",
  "public-holidays",
  "resource-allocations",
  "resource-capacity-by-employee",
  "project-margin-by-project",
  "resource-utilisation-by-employee",
  "project-milestones",
  "capacity-forecast-by-employee",
  "project-baselines",
  "project-change-orders",
  "project-earned-value-by-project",
  "project-subcontractor-costs",
  "project-revenue-schedules",
  "project-revenue-lines",
  "project-integration-intents",
  "hr-resources",
  "hr-skills",
  "hr-employee-skills",
] as const;

export type ProjectsWorkspaceResourceKey =
  (typeof PROJECTS_WORKSPACE_RESOURCE_KEYS)[number];

export type ProjectsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
