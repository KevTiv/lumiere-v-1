import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Proposals mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` proposals hooks.
 */
export const PROPOSALS_BFF_REDUCERS = [
  "add_proposal_comment",
  "add_proposal_line_item",
  "add_proposal_source_doc",
  "clear_proposal_presence",
  "create_proposal",
  "delete_proposal_line_item",
  "delete_proposal_section",
  "delete_proposal_source_doc",
  "reorder_proposal_line_items",
  "resolve_proposal_comment",
  "save_proposal_version",
  "update_proposal",
  "update_proposal_line_item",
  "update_proposal_presence",
  "update_proposal_source_doc",
  "update_proposal_status",
  "upsert_proposal_section",
] as const;

export type ProposalsBffReducerKey = (typeof PROPOSALS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<ProposalsBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function proposalsBffCallUrl(reducer: ProposalsBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function proposalsBffPost(
  reducer: ProposalsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: proposalsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const PROPOSALS_HINT_OVERRIDES: Partial<
  Record<ProposalsBffReducerKey, readonly string[]>
> = {
  add_proposal_comment: ["proposal-comments", "proposals"],
  add_proposal_line_item: ["proposal-line-items", "proposals"],
  add_proposal_source_doc: ["proposal-source-docs", "proposals"],
  clear_proposal_presence: ["proposal-presence", "proposals"],
  create_proposal: ["proposals"],
  delete_proposal_line_item: ["proposal-line-items", "proposals"],
  delete_proposal_section: ["proposal-sections", "proposals"],
  delete_proposal_source_doc: ["proposal-source-docs", "proposals"],
  reorder_proposal_line_items: ["proposal-line-items", "proposals"],
  resolve_proposal_comment: ["proposal-comments", "proposals"],
  save_proposal_version: ["proposal-versions", "proposals"],
  update_proposal: ["proposals"],
  update_proposal_line_item: ["proposal-line-items", "proposals"],
  update_proposal_presence: ["proposal-presence", "proposals"],
  update_proposal_source_doc: ["proposal-source-docs", "proposals"],
  update_proposal_status: ["proposals"],
  upsert_proposal_section: ["proposal-sections", "proposals"],
};

function proposalsReducerHints(): Record<
  ProposalsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<ProposalsBffReducerKey, readonly string[]>;
  for (const k of PROPOSALS_BFF_REDUCERS) {
    o[k] = PROPOSALS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const PROPOSALS_COMMAND_SUBSCRIPTION_HINTS: Record<
  ProposalsBffReducerKey,
  readonly string[]
> = proposalsReducerHints();

export function proposalsCommandContract(
  reducer: ProposalsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Proposals reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: PROPOSALS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
