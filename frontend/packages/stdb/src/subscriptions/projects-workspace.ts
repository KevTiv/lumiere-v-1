import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Projects list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const PROJECTS_WORKSPACE_RESOURCE_KEYS = [
  "projects",
  "tasks",
  "timesheets",
] as const;

export type ProjectsWorkspaceResourceKey =
  (typeof PROJECTS_WORKSPACE_RESOURCE_KEYS)[number];

export type ProjectsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
