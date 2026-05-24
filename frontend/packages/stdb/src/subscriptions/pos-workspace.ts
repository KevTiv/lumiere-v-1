import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * POS list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const POS_WORKSPACE_RESOURCE_KEYS = ["pos-terminals"] as const;

export type PosWorkspaceResourceKey =
  (typeof POS_WORKSPACE_RESOURCE_KEYS)[number];

export type PosWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
