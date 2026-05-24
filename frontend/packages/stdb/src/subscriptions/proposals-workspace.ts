import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Proposals list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const PROPOSALS_WORKSPACE_RESOURCE_KEYS = [
  "proposal-comments",
  "proposal-line-items",
  "proposal-presence",
  "proposal-sections",
  "proposal-source-docs",
  "proposal-versions",
  "proposals",
] as const;

export type ProposalsWorkspaceResourceKey =
  (typeof PROPOSALS_WORKSPACE_RESOURCE_KEYS)[number];

export type ProposalsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
