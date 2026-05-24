import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Organization / company / privacy list resources aligned with `GET /api/query/:resource`.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const ORGANIZATION_COMPANY_WORKSPACE_RESOURCE_KEYS = [
  "companies",
  "data-classifications",
  "data-classification-rules",
] as const;

export type OrganizationCompanyWorkspaceResourceKey =
  (typeof ORGANIZATION_COMPANY_WORKSPACE_RESOURCE_KEYS)[number];

export type OrganizationCompanyWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
