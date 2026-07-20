import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Workflow BFF query resources (private tables — HTTP owner SQL, not WS mirrors).
 */
export const WORKFLOWS_WORKSPACE_RESOURCE_KEYS = [
  "workflows",
  "workflow-versions",
  "workflow-nodes",
  "workflow-edges",
  "workflow-instances",
  "workflow-timers-late",
  "workflow-outbox-dead",
] as const;

export type WorkflowsWorkspaceResourceKey =
  (typeof WORKFLOWS_WORKSPACE_RESOURCE_KEYS)[number];

export type WorkflowsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
