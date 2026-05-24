import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Generic SpacetimeDB reducer calls via Next.js BFF `POST /api/call/:reducer`.
 * Used by `@lumiere/query-hooks/hooks/stdb` (`useStdbReducer`, `useStdbCallMutation`).
 *
 * Typed domains should prefer their own `*BffPost` wrappers; this module accepts any reducer name at runtime.
 */
export const STDB_BFF_REDUCERS = [] as const;

export type StdbBffReducerKey = string;

/** Same-origin path used by `apiFetch` in the web app. */
export function stdbBffCallUrl(reducer: string): string {
  return `/api/call/${encodeURIComponent(reducer)}`;
}

export function stdbBffPost(
  reducer: string,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: stdbBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

export function stdbCommandContract(
  reducer: string,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Generic SpacetimeDB reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: [],
    affectedTables: [],
    expectations:
      "Authenticated api-server session; prefer typed domain *BffPost when available.",
  };
}
