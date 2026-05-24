import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Manufacturing list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const MANUFACTURING_WORKSPACE_RESOURCE_KEYS = [
  "mrp-bom-lines",
  "mrp-boms",
  "mrp-productions",
  "mrp-routing-workcenters",
  "mrp-workcenters",
  "mrp-workorders",
  "quality-checks",
] as const;

export type ManufacturingWorkspaceResourceKey =
  (typeof MANUFACTURING_WORKSPACE_RESOURCE_KEYS)[number];

export type ManufacturingWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
