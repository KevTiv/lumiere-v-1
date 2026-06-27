import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Documents list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const DOCUMENTS_WORKSPACE_RESOURCE_KEYS = [
  "ai-document-processing-jobs",
  "ai-insights",
  "documents",
  "document-folders",
  "knowledge-articles",
  "knowledge-categories",
] as const;

export type DocumentsWorkspaceResourceKey =
  (typeof DOCUMENTS_WORKSPACE_RESOURCE_KEYS)[number];

export type DocumentsWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
