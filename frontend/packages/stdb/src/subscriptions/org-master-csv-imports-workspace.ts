import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Query resources that may reflect org-scoped master CSV import reducer effects.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const ORG_MASTER_CSV_IMPORTS_WORKSPACE_RESOURCE_KEYS = [
  "ai-agents",
  "companies",
  "roles",
] as const;

export type OrgMasterCsvImportsWorkspaceResourceKey =
  (typeof ORG_MASTER_CSV_IMPORTS_WORKSPACE_RESOURCE_KEYS)[number];

export type OrgMasterCsvImportsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
