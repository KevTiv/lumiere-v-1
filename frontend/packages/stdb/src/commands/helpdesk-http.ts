import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Helpdesk mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` helpdesk hooks.
 */
export const HELPDESK_BFF_REDUCERS = [
  "assign_ticket",
  "close_ticket",
  "create_helpdesk_sla",
  "create_helpdesk_stage",
  "create_helpdesk_team",
  "create_ticket",
  "import_helpdesk_sla_csv",
  "import_helpdesk_stage_csv",
  "import_helpdesk_team_csv",
  "import_helpdesk_ticket_csv",
  "reopen_ticket",
  "update_ticket",
] as const;

export type HelpdeskBffReducerKey = (typeof HELPDESK_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<HelpdeskBffReducerKey>();

const HELPDESK_RESOURCE_KEYS = [
  "helpdesk-tickets",
  "helpdesk-teams",
  "helpdesk-stages",
  "helpdesk-slas",
] as const;

/** Same-origin path used by `apiFetch` in the web app. */
export function helpdeskBffCallUrl(reducer: HelpdeskBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function helpdeskBffPost(
  reducer: HelpdeskBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: helpdeskBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const HELPDESK_HINT_OVERRIDES: Partial<
  Record<HelpdeskBffReducerKey, readonly string[]>
> = {
  assign_ticket: HELPDESK_RESOURCE_KEYS,
  close_ticket: HELPDESK_RESOURCE_KEYS,
  create_helpdesk_sla: HELPDESK_RESOURCE_KEYS,
  create_helpdesk_stage: HELPDESK_RESOURCE_KEYS,
  create_helpdesk_team: HELPDESK_RESOURCE_KEYS,
  create_ticket: HELPDESK_RESOURCE_KEYS,
  import_helpdesk_sla_csv: HELPDESK_RESOURCE_KEYS,
  import_helpdesk_stage_csv: HELPDESK_RESOURCE_KEYS,
  import_helpdesk_team_csv: HELPDESK_RESOURCE_KEYS,
  import_helpdesk_ticket_csv: HELPDESK_RESOURCE_KEYS,
  reopen_ticket: HELPDESK_RESOURCE_KEYS,
  update_ticket: HELPDESK_RESOURCE_KEYS,
};

function helpdeskReducerHints(): Record<
  HelpdeskBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<HelpdeskBffReducerKey, readonly string[]>;
  for (const k of HELPDESK_BFF_REDUCERS) {
    o[k] = HELPDESK_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const HELPDESK_COMMAND_SUBSCRIPTION_HINTS: Record<
  HelpdeskBffReducerKey,
  readonly string[]
> = helpdeskReducerHints();

export function helpdeskCommandContract(
  reducer: HelpdeskBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Helpdesk reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: HELPDESK_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
