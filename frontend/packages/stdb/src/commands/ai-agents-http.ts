
import type { ReducerCommandContractMeta } from "./types";

/**
 * AI agents mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` ai-agents hooks.
 */
export const AI_AGENTS_BFF_REDUCERS = [
  "create_ai_agent",
  "create_ai_insight",
  "create_ai_team_member",
  "dismiss_insight",
  "record_ai_spend",
  "set_ai_agent_active",
  "update_ai_agent",
] as const;

export type AiAgentsBffReducerKey = (typeof AI_AGENTS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<AiAgentsBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function aiAgentsBffCallUrl(reducer: AiAgentsBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

const AI_AGENTS_HINT_OVERRIDES: Partial<
  Record<AiAgentsBffReducerKey, readonly string[]>
> = {
  create_ai_agent: ["ai-agents"],
  update_ai_agent: ["ai-agents"],
  set_ai_agent_active: ["ai-agents"],
  record_ai_spend: ["ai-agents"],
};

function aiAgentsReducerHints(): Record<
  AiAgentsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<AiAgentsBffReducerKey, readonly string[]>;
  for (const k of AI_AGENTS_BFF_REDUCERS) {
    o[k] = AI_AGENTS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const AI_AGENTS_COMMAND_SUBSCRIPTION_HINTS: Record<
  AiAgentsBffReducerKey,
  readonly string[]
> = aiAgentsReducerHints();

export function aiAgentsCommandContract(
  reducer: AiAgentsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `AI agents reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: AI_AGENTS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
