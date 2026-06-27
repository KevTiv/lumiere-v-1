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
  "update_lead_details",
  "update_lead_address",
  "update_lead_revenue",
  "create_contact_tag",
  "create_contact_segment",
  "convert_lead_to_customer",
  "convert_opportunity_to_sale_order",
  "delete_contact",
  "delete_lead",
  "assign_tag_to_contact",
  "add_contact_to_segment",
  "complete_activity",
  "import_contact_csv",
  "import_lead_csv",
  "import_opportunity_csv",
] as const;

export type CrmBffReducerKey = (typeof CRM_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<CrmBffReducerKey>([
  "convert_opportunity_to_sale_order",
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
  update_lead_details: ["leads"],
  update_lead_address: ["leads"],
  update_lead_revenue: ["leads"],
  create_contact_tag: ["contacts"],
  create_contact_segment: ["contacts"],
  convert_lead_to_customer: ["leads", "contacts", "opportunities"],
  convert_opportunity_to_sale_order: ["opportunities", "sale-orders"],
  delete_contact: ["contacts"],
  delete_lead: ["leads"],
  assign_tag_to_contact: ["contacts"],
  add_contact_to_segment: ["contacts"],
  complete_activity: ["activities"],
  import_contact_csv: ["contacts"],
  import_lead_csv: ["leads"],
  import_opportunity_csv: ["opportunities"],
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
