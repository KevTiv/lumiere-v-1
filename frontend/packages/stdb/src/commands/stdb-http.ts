import { stringifyReducerCommandBody } from "@lumiere/api-client";
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs";

import type { ReducerCommandContractMeta } from "./types";
import {
  STDB_BFF_REDUCERS,
  type StdbBffReducerKey,
} from "./generated-stdb-bff-reducers";

export { STDB_BFF_REDUCERS, type StdbBffReducerKey };

type NamedReducerKey = Extract<StdbBffReducerKey, keyof OperationInputMap>;
type WireField<T> =
  | T
  | null
  | (T extends bigint ? number | string : never)
  | (T extends object ? Record<string, unknown> : never)
  | { some: unknown }
  | { none: [] };

export type StdbBffCommandInput<K extends NamedReducerKey> = {
  [P in keyof OperationInputMap[K]]: WireField<OperationInputMap[K][P]>;
};

/** Same-origin path used by `apiFetch` in the web app. */
export function stdbBffCallUrl(reducer: StdbBffReducerKey): string {
  return `/api/call/${encodeURIComponent(reducer)}`;
}

/**
 * Named command transport. The input deliberately omits `organization_id`;
 * api-server injects it from the authenticated session using contract metadata.
 */
export function stdbBffCommandPost<K extends NamedReducerKey>(
  reducer: K,
  input: StdbBffCommandInput<K>,
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: stdbBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCommandBody(input),
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
      "Authenticated api-server session; send generated named command inputs.",
  };
}
