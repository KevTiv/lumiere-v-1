import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Auth / RBAC / audit list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const AUTH_WORKSPACE_RESOURCE_KEYS = [
  "audit-log",
  "audit-rules",
  "roles",
  "user-invites",
  "user-roles",
  "user-sessions",
  "users",
] as const;

export type AuthWorkspaceResourceKey = (typeof AUTH_WORKSPACE_RESOURCE_KEYS)[number];

export type AuthWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
