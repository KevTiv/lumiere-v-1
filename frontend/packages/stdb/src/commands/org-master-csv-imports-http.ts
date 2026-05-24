import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Org-scoped master-data CSV import reducers via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` org-master-csv-imports hooks.
 * All reducers take `(organization_id, csv_data)` — no company scope.
 */
export const ORG_MASTER_CSV_IMPORTS_BFF_REDUCERS = [
  "import_ai_agent_csv",
  "import_company_csv",
  "import_country_csv",
  "import_currency_csv",
  "import_currency_rate_csv",
  "import_role_csv",
] as const;

export type OrgMasterCsvImportsBffReducerKey =
  (typeof ORG_MASTER_CSV_IMPORTS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<OrgMasterCsvImportsBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function orgMasterCsvImportsBffCallUrl(
  reducer: OrgMasterCsvImportsBffReducerKey,
): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function orgMasterCsvImportsBffPost(
  reducer: OrgMasterCsvImportsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: orgMasterCsvImportsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const ORG_MASTER_CSV_IMPORTS_HINT_OVERRIDES: Partial<
  Record<OrgMasterCsvImportsBffReducerKey, readonly string[]>
> = {
  import_company_csv: ["companies"],
  import_role_csv: ["roles"],
  import_ai_agent_csv: ["ai-agents"],
};

function orgMasterCsvImportsReducerHints(): Record<
  OrgMasterCsvImportsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<OrgMasterCsvImportsBffReducerKey, readonly string[]>;
  for (const k of ORG_MASTER_CSV_IMPORTS_BFF_REDUCERS) {
    o[k] = ORG_MASTER_CSV_IMPORTS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const ORG_MASTER_CSV_IMPORTS_COMMAND_SUBSCRIPTION_HINTS: Record<
  OrgMasterCsvImportsBffReducerKey,
  readonly string[]
> = orgMasterCsvImportsReducerHints();

export function orgMasterCsvImportsCommandContract(
  reducer: OrgMasterCsvImportsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Org master CSV import reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources:
      ORG_MASTER_CSV_IMPORTS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args are [organization_id, csv_data].",
  };
}
