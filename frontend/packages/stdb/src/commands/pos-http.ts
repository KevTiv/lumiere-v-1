
import type { ReducerCommandContractMeta } from "./types";

/**
 * POS mutations via Next.js BFF `POST /api/operations/:operation`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` pos hooks.
 */
export const POS_BFF_REDUCERS = [
  "activate_pos_config",
  "close_pos_session",
  "compute_pos_session_totals",
  "create_pos_config",
  "create_pos_order",
  "create_pos_terminal",
  "deactivate_pos_config",
  "open_pos_session",
  "update_pos_terminal",
] as const;

export type PosBffReducerKey = (typeof POS_BFF_REDUCERS)[number];

const POS_HINT_OVERRIDES: Partial<Record<PosBffReducerKey, readonly string[]>> =
  {
    activate_pos_config: ["pos-terminals", "pos-configs"],
    close_pos_session: ["pos-terminals", "pos-sessions"],
    compute_pos_session_totals: ["pos-terminals", "pos-sessions"],
    create_pos_config: ["pos-terminals", "pos-configs"],
    create_pos_order: ["pos-terminals"],
    create_pos_terminal: ["pos-terminals"],
    deactivate_pos_config: ["pos-terminals", "pos-configs"],
    open_pos_session: ["pos-terminals", "pos-sessions", "pos-configs"],
    update_pos_terminal: ["pos-terminals"],
  };

function posReducerHints(): Record<PosBffReducerKey, readonly string[]> {
  const o = {} as Record<PosBffReducerKey, readonly string[]>;
  for (const k of POS_BFF_REDUCERS) {
    o[k] = POS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const POS_COMMAND_SUBSCRIPTION_HINTS: Record<
  PosBffReducerKey,
  readonly string[]
> = posReducerHints();

export function posCommandContract(
  reducer: PosBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `POS reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: POS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
