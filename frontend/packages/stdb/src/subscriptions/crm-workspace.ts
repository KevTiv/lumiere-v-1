import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * CRM list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const CRM_WORKSPACE_RESOURCE_KEYS = [
  "users",
] as const;

/**
 * CRM tables are private in SpacetimeDB. Product reads and live refreshes go through
 * the authenticated BFF/API websocket; only the shared user lookup remains direct.
 */

export type CrmWorkspaceResourceKey = (typeof CRM_WORKSPACE_RESOURCE_KEYS)[number];

export type CrmWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
