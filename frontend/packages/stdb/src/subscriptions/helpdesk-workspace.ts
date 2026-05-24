import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Helpdesk list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const HELPDESK_WORKSPACE_RESOURCE_KEYS = [
  "helpdesk-slas",
  "helpdesk-stages",
  "helpdesk-teams",
  "helpdesk-tickets",
] as const;

export type HelpdeskWorkspaceResourceKey =
  (typeof HELPDESK_WORKSPACE_RESOURCE_KEYS)[number];

export type HelpdeskWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
