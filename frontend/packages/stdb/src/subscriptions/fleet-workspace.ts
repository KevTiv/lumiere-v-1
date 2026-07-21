import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Fleet list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const FLEET_WORKSPACE_RESOURCE_KEYS = ["fleet-vehicles", "warehouse-geo"] as const;

export type FleetWorkspaceResourceKey = (typeof FLEET_WORKSPACE_RESOURCE_KEYS)[number];

export type FleetWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
