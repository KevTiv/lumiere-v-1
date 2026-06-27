import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * AI skills mutations via Next.js BFF `POST /api/call/:reducer`.
 */
export const AI_SKILLS_BFF_REDUCERS = [
  "create_ai_skill",
  "upsert_ai_skill",
  "set_ai_skill_active",
  "upsert_ai_skill_config",
  "assign_team_member_skill",
  "unassign_team_member_skill",
] as const;

export type AiSkillsBffReducerKey = (typeof AI_SKILLS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<AiSkillsBffReducerKey>();

export function aiSkillsBffCallUrl(reducer: AiSkillsBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function aiSkillsBffPost(
  reducer: AiSkillsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: aiSkillsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const AI_SKILLS_HINT_OVERRIDES: Partial<
  Record<AiSkillsBffReducerKey, readonly string[]>
> = {
  create_ai_skill: ["ai-skills"],
  upsert_ai_skill: ["ai-skills"],
  set_ai_skill_active: ["ai-skills"],
  upsert_ai_skill_config: ["ai-skills"],
  assign_team_member_skill: ["ai-team-member-skills"],
  unassign_team_member_skill: ["ai-team-member-skills"],
};

function aiSkillsReducerHints(): Record<AiSkillsBffReducerKey, readonly string[]> {
  const o = {} as Record<AiSkillsBffReducerKey, readonly string[]>;
  for (const k of AI_SKILLS_BFF_REDUCERS) {
    o[k] = AI_SKILLS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const AI_SKILLS_COMMAND_SUBSCRIPTION_HINTS: Record<
  AiSkillsBffReducerKey,
  readonly string[]
> = aiSkillsReducerHints();

export function aiSkillsCommandContract(
  reducer: AiSkillsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `AI skills reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: AI_SKILLS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
