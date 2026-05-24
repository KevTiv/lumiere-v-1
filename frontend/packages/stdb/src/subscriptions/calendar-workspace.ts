import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Calendar list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const CALENDAR_WORKSPACE_RESOURCE_KEYS = ["calendar-events"] as const;

export type CalendarWorkspaceResourceKey =
  (typeof CALENDAR_WORKSPACE_RESOURCE_KEYS)[number];

export type CalendarWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
