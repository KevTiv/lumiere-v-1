import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * AI agents list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const AI_AGENTS_WORKSPACE_RESOURCE_KEYS = ["ai-agents"] as const;

export type AiAgentsWorkspaceResourceKey =
  (typeof AI_AGENTS_WORKSPACE_RESOURCE_KEYS)[number];

export type AiAgentsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
