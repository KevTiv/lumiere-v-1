import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

export const AI_ACTION_DRAFTS_BFF_REDUCERS = [
  "approve_ai_action_draft",
  "create_ai_action_draft",
  "expire_ai_action_drafts",
  "reject_ai_action_draft",
  "update_ai_action_draft_params",
] as const;

export type AiActionDraftsBffReducerKey =
  (typeof AI_ACTION_DRAFTS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<AiActionDraftsBffReducerKey>([
  "approve_ai_action_draft",
  "create_ai_action_draft",
  "expire_ai_action_drafts",
  "reject_ai_action_draft",
  "update_ai_action_draft_params",
]);

export function aiActionDraftsBffCallUrl(
  reducer: AiActionDraftsBffReducerKey,
): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function aiActionDraftsBffPost(
  reducer: AiActionDraftsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: aiActionDraftsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

export const AI_ACTION_DRAFTS_COMMAND_SUBSCRIPTION_HINTS: Record<
  AiActionDraftsBffReducerKey,
  readonly string[]
> = {
  approve_ai_action_draft: ["ai-action-drafts", "ai-action-drafts-inbox"],
  create_ai_action_draft: ["ai-action-drafts", "ai-action-drafts-inbox"],
  expire_ai_action_drafts: ["ai-action-drafts", "ai-action-drafts-inbox"],
  reject_ai_action_draft: ["ai-action-drafts", "ai-action-drafts-inbox"],
  update_ai_action_draft_params: ["ai-action-drafts", "ai-action-drafts-inbox"],
};

export function aiActionDraftsCommandContract(
  reducer: AiActionDraftsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `AI action draft reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources:
      AI_ACTION_DRAFTS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: ["ai_action_draft"],
    expectations:
      "Authenticated session with organization and company scope; drafts require human approval before execution.",
  };
}
