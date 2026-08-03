import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * CRM mutations invoked via Next.js BFF `POST /api/call/:reducer` (forwarded to api-server `/v1/call/:reducer`).
 * Keys match SpacetimeDB reducer snake_case names.
 */
export const CRM_BFF_REDUCERS = [
  "create_lead",
  "create_opportunity",
  "update_opportunity",
  "create_contact",
  "create_activity",
  "update_contact",
  "update_contact_address",
  "update_contact_business",
  "update_contact_details",
  "update_lead",
  "update_lead_details",
  "update_lead_address",
  "update_lead_revenue",
  "create_contact_tag",
  "create_contact_segment",
  "convert_lead_to_customer",
  "convert_opportunity_to_sale_order",
  "create_opportunity_line",
  "delete_contact",
  "delete_lead",
  "assign_tag_to_contact",
  "add_contact_to_segment",
  "complete_activity",
  "find_duplicate_contacts",
  "import_contact_csv",
  "import_lead_csv",
  "import_opportunity_csv",
  "merge_contacts",
  "create_contact_identity",
  "update_contact_identity",
  "verify_contact_identity",
  "archive_contact_identity",
  "assign_contact_role",
  "end_contact_role",
  "create_contact_relationship",
  "end_contact_relationship",
  "update_contact_parent",
  "create_opportunity_stage",
  "update_opportunity_stage",
  "create_lead_source",
  "update_lead_source",
  "create_lead_lost_reason",
  "update_lead_lost_reason",
  "create_assignment_rule",
  "update_assignment_rule",
  "update_opportunity_presence",
  "clear_opportunity_presence",
  "create_forecast_snapshot",
  "recompute_lead_score",
  "set_contact_segment_rules",
  "evaluate_dynamic_segment",
  "recompute_relationship_insights",
  "open_crm_conversation",
  "append_crm_conversation_message",
  "update_crm_conversation",
  "create_contact_category",
  "update_contact_category",
  "archive_contact_category",
  "add_contact_categories",
  "remove_contact_categories",
  "replace_contact_categories",
  "clear_contact_categories",
] as const;

export type CrmBffReducerKey = (typeof CRM_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<CrmBffReducerKey>([
  "convert_opportunity_to_sale_order",
  "create_opportunity_line",
  "update_contact_parent",
  "create_forecast_snapshot",
]);

/** Same-origin path used by `apiFetch` in the web app. */
export function crmBffCallUrl(reducer: CrmBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function crmBffPost(
  reducer: CrmBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: crmBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

/** Subscription resource keys whose mirrors should reflect CRM reducer effects (compose with `auth`). */
export const CRM_COMMAND_SUBSCRIPTION_HINTS: Record<
  CrmBffReducerKey,
  readonly string[]
> = {
  create_lead: ["leads"],
  create_opportunity: ["opportunities"],
  update_opportunity: ["opportunities"],
  create_contact: ["contacts"],
  create_activity: ["activities"],
  update_contact: ["contacts"],
  update_contact_address: ["contacts"],
  update_contact_business: ["contacts"],
  update_contact_details: ["contacts"],
  update_lead: ["leads"],
  update_lead_details: ["leads"],
  update_lead_address: ["leads"],
  update_lead_revenue: ["leads"],
  create_contact_tag: ["contacts"],
  create_contact_segment: ["contacts"],
  convert_lead_to_customer: ["leads", "contacts", "opportunities"],
  convert_opportunity_to_sale_order: ["opportunities", "sale-orders"],
  create_opportunity_line: ["opportunity-lines", "opportunities"],
  delete_contact: ["contacts"],
  delete_lead: ["leads"],
  find_duplicate_contacts: ["contacts"],
  assign_tag_to_contact: ["contacts"],
  add_contact_to_segment: ["contacts"],
  complete_activity: ["activities"],
  import_contact_csv: ["contacts"],
  import_lead_csv: ["leads"],
  import_opportunity_csv: ["opportunities"],
  merge_contacts: ["contacts", "leads", "opportunities", "sale-orders"],
  create_contact_identity: ["contact-phone-identities"],
  update_contact_identity: ["contact-phone-identities"],
  verify_contact_identity: ["contact-phone-identities"],
  archive_contact_identity: ["contact-phone-identities"],
  assign_contact_role: ["contact-role-assignments"],
  end_contact_role: ["contact-role-assignments"],
  create_contact_relationship: ["contact-relationships"],
  end_contact_relationship: ["contact-relationships"],
  update_contact_parent: ["contacts"],
  create_opportunity_stage: ["opportunity-stages"],
  update_opportunity_stage: ["opportunity-stages"],
  create_lead_source: ["lead-sources"],
  update_lead_source: ["lead-sources"],
  create_lead_lost_reason: ["lead-lost-reasons"],
  update_lead_lost_reason: ["lead-lost-reasons"],
  create_assignment_rule: ["assignment-rules"],
  update_assignment_rule: ["assignment-rules"],
  update_opportunity_presence: ["opportunity-presence"],
  clear_opportunity_presence: ["opportunity-presence"],
  create_forecast_snapshot: ["crm-forecast-snapshots"],
  recompute_lead_score: ["lead-scores", "lead-score-factors"],
  set_contact_segment_rules: ["contact-segment-rules"],
  evaluate_dynamic_segment: ["contact-segments", "segment-members"],
  recompute_relationship_insights: ["contact-relationship-insights"],
  open_crm_conversation: ["crm-conversations"],
  append_crm_conversation_message: [
    "crm-conversation-messages",
    "crm-conversations",
  ],
  update_crm_conversation: ["crm-conversations"],
  create_contact_category: ["contact-categories"],
  update_contact_category: ["contact-categories"],
  archive_contact_category: ["contact-categories"],
  add_contact_categories: ["contact-category-assignments", "contacts"],
  remove_contact_categories: ["contact-category-assignments", "contacts"],
  replace_contact_categories: ["contact-category-assignments", "contacts"],
  clear_contact_categories: ["contact-category-assignments", "contacts"],
};

export function crmCommandContract(
  reducer: CrmBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `CRM reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: CRM_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
