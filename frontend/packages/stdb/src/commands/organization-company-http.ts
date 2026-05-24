import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Organization / company / privacy mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` organization-company hooks.
 */
export const ORGANIZATION_COMPANY_BFF_REDUCERS = [
  "create_company",
  "create_data_classification",
  "create_data_classification_rule",
  "delete_company",
  "update_company",
  "update_company_address",
  "update_company_business",
  "update_company_hierarchy",
] as const;

export type OrganizationCompanyBffReducerKey =
  (typeof ORGANIZATION_COMPANY_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<OrganizationCompanyBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function organizationCompanyBffCallUrl(
  reducer: OrganizationCompanyBffReducerKey,
): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function organizationCompanyBffPost(
  reducer: OrganizationCompanyBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: organizationCompanyBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const ORGANIZATION_COMPANY_HINT_OVERRIDES: Partial<
  Record<OrganizationCompanyBffReducerKey, readonly string[]>
> = {
  create_company: ["companies"],
  update_company: ["companies"],
  update_company_address: ["companies"],
  update_company_business: ["companies"],
  update_company_hierarchy: ["companies"],
  delete_company: ["companies"],
  create_data_classification: ["data-classifications"],
  create_data_classification_rule: ["data-classification-rules"],
};

function organizationCompanyReducerHints(): Record<
  OrganizationCompanyBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<OrganizationCompanyBffReducerKey, readonly string[]>;
  for (const k of ORGANIZATION_COMPANY_BFF_REDUCERS) {
    o[k] = ORGANIZATION_COMPANY_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const ORGANIZATION_COMPANY_COMMAND_SUBSCRIPTION_HINTS: Record<
  OrganizationCompanyBffReducerKey,
  readonly string[]
> = organizationCompanyReducerHints();

export function organizationCompanyCommandContract(
  reducer: OrganizationCompanyBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Organization/company reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources:
      ORGANIZATION_COMPANY_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
