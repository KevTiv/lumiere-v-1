import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Organization settings query/cache keys aligned with settings hooks invalidation.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const SETTINGS_WORKSPACE_RESOURCE_KEYS = [
  "organization",
  "organization-settings",
  "organizations",
] as const;

export type SettingsWorkspaceResourceKey =
  (typeof SETTINGS_WORKSPACE_RESOURCE_KEYS)[number];

export type SettingsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
