import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Messages list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const MESSAGES_WORKSPACE_RESOURCE_KEYS = ["mail-messages"] as const;

export type MessagesWorkspaceResourceKey =
  (typeof MESSAGES_WORKSPACE_RESOURCE_KEYS)[number];

export type MessagesWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
