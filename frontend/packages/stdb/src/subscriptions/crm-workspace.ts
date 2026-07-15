import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * CRM list/query resources aligned with `GET /api/query/:resource` and WebSocket mirrors.
 * Compose with session workspace keys (`auth` bundle via `SESSION_WORKSPACE_RESOURCE_KEYS`).
 */
export const CRM_WORKSPACE_RESOURCE_KEYS = [
  "leads",
  "lead-sources",
  "lead-lost-reasons",
  "opportunities",
  "opportunity-stages",
  "opportunity-lines",
  "opportunity-presence",
  "contacts",
  "contact-phone-identities",
  "contact-role-assignments",
  "contact-tags",
  "contact-tag-assignments",
  "contact-segments",
  "segment-members",
  "contact-relationships",
  "contact-duplicate-candidates",
  "assignment-rules",
  "activities",
  "calendar-events",
  "utm-campaigns",
  "utm-media",
  "utm-sources",
  "privacy-consent",
  "contact-communication-preferences",
  "crm-forecast-snapshots",
  "lead-scores",
  "lead-score-factors",
  "contact-segment-rules",
  "contact-relationship-insights",
  "crm-conversations",
  "crm-conversation-messages",
  "users",
] as const;

export type CrmWorkspaceResourceKey = (typeof CRM_WORKSPACE_RESOURCE_KEYS)[number];

export type CrmWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId" | "companyIds" | "fieldAccess"
>;
