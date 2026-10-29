import { stringifyReducerCommandBody } from "@lumiere/api-client";
import type { SessionOperationName } from "@lumiere/contracts/generated/operation-descriptors";
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs";

import {
  SESSION_OPERATION_IDS,
  SESSION_OPERATION_NAMES,
} from "../generated/browser-operation-ids";

import type { ReducerCommandContractMeta } from "./types";

/** Backward-compatible names for the canonical session-operation surface. */
const STDB_BFF_REDUCERS = SESSION_OPERATION_NAMES;
type StdbBffReducerKey = SessionOperationName;

export { STDB_BFF_REDUCERS, type StdbBffReducerKey };

export type StdbBffNamedReducerKey = Extract<SessionOperationName, keyof OperationInputMap>;
/** Exact generated operation inputs behind the stable package boundary. */
export type StdbNamedOperationInput<K extends StdbBffNamedReducerKey> = OperationInputMap[K];

type StdbWireField<T> =
  | T
  | null
  | (T extends bigint ? number | string : never)
  | (T extends object ? Record<string, unknown> : never)
  | { __identity__: string }
  | { some: unknown }
  | { none: [] };

export type StdbBffCommandInput<K extends StdbBffNamedReducerKey> = {
  [P in keyof OperationInputMap[K]]: StdbWireField<OperationInputMap[K][P]>;
};

/** Same-origin typed-operation path for all named command consumers. */
export function stdbBffCallUrl(reducer: StdbBffReducerKey): string {
  if (!Object.hasOwn(SESSION_OPERATION_IDS, reducer)) {
    throw new Error(`Unknown session operation: ${reducer}`);
  }
  const operationId = SESSION_OPERATION_IDS[reducer];
  return `/api/operations/${encodeURIComponent(operationId)}`;
}

/**
 * Named operation transport. The input deliberately omits `organization_id`;
 * api-server injects it from the authenticated session using locked contract
 * operation metadata.
 */
export function stdbBffCommandPost<K extends StdbBffNamedReducerKey>(
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
