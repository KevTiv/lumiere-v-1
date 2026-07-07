import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * AI reducer allowlist mutations via Next.js BFF `POST /api/call/:reducer`.
 */
export const AI_REDUCER_ALLOWLIST_BFF_REDUCERS = [
  "create_ai_reducer_allowlist",
  "update_ai_reducer_allowlist",
  "delete_ai_reducer_allowlist",
  "set_ai_reducer_allowlist_enabled",
] as const;

export type AiReducerAllowlistBffReducerKey =
  (typeof AI_REDUCER_ALLOWLIST_BFF_REDUCERS)[number];

export function aiReducerAllowlistBffCallUrl(
  reducer: AiReducerAllowlistBffReducerKey,
): string {
  return `/api/call/${reducer}`;
}

export function aiReducerAllowlistBffPost(
  reducer: AiReducerAllowlistBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: aiReducerAllowlistBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const HINT_OVERRIDES: Partial<
  Record<AiReducerAllowlistBffReducerKey, readonly string[]>
> = {
  create_ai_reducer_allowlist: ["ai-reducer-allowlist"],
  update_ai_reducer_allowlist: ["ai-reducer-allowlist"],
  delete_ai_reducer_allowlist: ["ai-reducer-allowlist"],
  set_ai_reducer_allowlist_enabled: ["ai-reducer-allowlist"],
};

function reducerHints(): Record<
  AiReducerAllowlistBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<AiReducerAllowlistBffReducerKey, readonly string[]>;
  for (const k of AI_REDUCER_ALLOWLIST_BFF_REDUCERS) {
    o[k] = HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const AI_REDUCER_ALLOWLIST_COMMAND_SUBSCRIPTION_HINTS: Record<
  AiReducerAllowlistBffReducerKey,
  readonly string[]
> = reducerHints();

export function aiReducerAllowlistCommandContract(
  reducer: AiReducerAllowlistBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `AI reducer allowlist reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources:
      AI_REDUCER_ALLOWLIST_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: ["ai_reducer_allowlist"],
    expectations:
      "Authenticated api-server session with organization scope; requires ai_action_draft write permission.",
  };
}
