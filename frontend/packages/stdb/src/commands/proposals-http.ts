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
  "answer_proposal_clarification",
  "apply_proposal_analysis",
  "apply_proposal_template",
  "approve_proposal",
  "clear_proposal_presence",
  "cleanup_stale_proposal_presence",
  "complete_proposal_integration_intent",
  "convert_proposal_to_project",
  "convert_proposal_to_sale_order",
  "create_proposal",
  "create_proposal_clarification",
  "create_proposal_clause",
  "create_proposal_integration_intent",
  "create_proposal_template",
  "delete_proposal_line_item",
  "delete_proposal_section",
  "delete_proposal_source_doc",
  "fail_proposal_integration_intent",
  "link_proposal_version_esign",
  "record_proposal_bid_decision",
  "reorder_proposal_line_items",
  "resolve_proposal_comment",
  "resolve_proposal_section_conflict",
  "restore_proposal_version",
  "save_proposal_version",
  "update_proposal",
  "update_proposal_line_item",
  "update_proposal_presence",
  "update_proposal_source_doc",
  "update_proposal_status",
  "upsert_proposal_compliance_requirement",
  "upsert_proposal_procurement_score",
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
  answer_proposal_clarification: ["proposal-clarifications", "proposals"],
  apply_proposal_analysis: [
    "proposal-analyses",
    "proposal-compliance-requirements",
    "proposals",
  ],
  apply_proposal_template: ["proposal-sections", "proposal-templates", "proposals"],
  approve_proposal: ["proposals"],
  clear_proposal_presence: ["proposal-presence", "proposals"],
  cleanup_stale_proposal_presence: ["proposal-presence"],
  complete_proposal_integration_intent: ["proposal-integration-intents"],
  convert_proposal_to_project: ["proposals"],
  convert_proposal_to_sale_order: ["proposals", "sale-orders"],
  create_proposal: ["proposals"],
  create_proposal_clarification: ["proposal-clarifications", "proposals"],
  create_proposal_clause: ["proposal-clauses"],
  create_proposal_integration_intent: ["proposal-integration-intents", "proposals"],
  create_proposal_template: ["proposal-templates"],
  delete_proposal_line_item: ["proposal-line-items", "proposals"],
  delete_proposal_section: ["proposal-sections", "proposals"],
  delete_proposal_source_doc: ["proposal-source-docs", "proposals"],
  fail_proposal_integration_intent: ["proposal-integration-intents"],
  link_proposal_version_esign: ["proposal-integration-intents", "proposal-versions"],
  record_proposal_bid_decision: ["proposal-bid-decisions", "proposals"],
  reorder_proposal_line_items: ["proposal-line-items", "proposals"],
  resolve_proposal_comment: ["proposal-comments", "proposals"],
  resolve_proposal_section_conflict: ["proposal-sections", "proposals"],
  restore_proposal_version: ["proposal-sections", "proposal-versions", "proposals"],
  save_proposal_version: ["proposal-versions", "proposals"],
  update_proposal: ["proposals"],
  update_proposal_line_item: ["proposal-line-items", "proposals"],
  update_proposal_presence: ["proposal-presence", "proposals"],
  update_proposal_source_doc: ["proposal-source-docs", "proposals"],
  update_proposal_status: ["proposals"],
  upsert_proposal_compliance_requirement: [
    "proposal-compliance-requirements",
    "proposals",
  ],
  upsert_proposal_procurement_score: ["proposal-procurement-scores", "proposals"],
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
      "Authenticated api-server session with organization + company scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
