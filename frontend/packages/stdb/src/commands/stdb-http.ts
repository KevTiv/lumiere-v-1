import { stringifyReducerCommandBody } from "@lumiere/api-client";
import {
  SESSION_OPERATION_DESCRIPTORS,
  SESSION_OPERATION_NAMES,
  type SessionOperationName,
} from "@lumiere/contracts/generated/operation-descriptors";
import type {
  SdkOperationInput,
  SdkOperationName,
} from "@lumiere/contracts/generated/sdk";

import type { ReducerCommandContractMeta } from "./types";

/** Backward-compatible names for the canonical session-operation surface. */
const STDB_BFF_REDUCERS = SESSION_OPERATION_NAMES;
type StdbBffReducerKey = SessionOperationName;

export { STDB_BFF_REDUCERS, type StdbBffReducerKey };

export type StdbBffNamedReducerKey = SdkOperationName;
export type StdbBffCommandInput<K extends StdbBffNamedReducerKey> = SdkOperationInput<K>;

/** Same-origin typed-operation path for all named command consumers. */
export function stdbBffCallUrl(reducer: StdbBffReducerKey): string {
  const operationId = SESSION_OPERATION_DESCRIPTORS[reducer].contractOperationId;
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
