import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";
import {
  STDB_BFF_REDUCERS,
  type StdbBffReducerKey,
} from "./generated-stdb-bff-reducers";

export { STDB_BFF_REDUCERS, type StdbBffReducerKey };

/** Same-origin path used by `apiFetch` in the web app. */
export function stdbBffCallUrl(reducer: StdbBffReducerKey): string {
  return `/api/call/${encodeURIComponent(reducer)}`;
}

export function stdbBffPost(
  reducer: StdbBffReducerKey,
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
  reducer: StdbBffReducerKey,
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
