import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Workflows list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const WORKFLOWS_WORKSPACE_RESOURCE_KEYS = [
  "workflow-activities",
  "workflow-instances",
  "workflow-transitions",
  "workflow-workitems",
  "workflows",
] as const;

export type WorkflowsWorkspaceResourceKey =
  (typeof WORKFLOWS_WORKSPACE_RESOURCE_KEYS)[number];

export type WorkflowsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
