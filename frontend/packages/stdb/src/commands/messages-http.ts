import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Messages mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` messages hooks.
 */
export const MESSAGES_BFF_REDUCERS = ["post_message"] as const;

export type MessagesBffReducerKey = (typeof MESSAGES_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<MessagesBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function messagesBffCallUrl(reducer: MessagesBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function messagesBffPost(
  reducer: MessagesBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: messagesBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

/** Subscription resource keys whose mirrors should reflect messages reducer effects. */
export const MESSAGES_COMMAND_SUBSCRIPTION_HINTS: Record<
  MessagesBffReducerKey,
  readonly string[]
> = {
  post_message: ["mail-messages"],
};

export function messagesCommandContract(
  reducer: MessagesBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Messages reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: MESSAGES_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
