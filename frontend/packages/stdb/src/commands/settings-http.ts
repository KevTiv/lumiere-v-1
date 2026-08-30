
import type { ReducerCommandContractMeta } from "./types";

/**
 * Organization settings mutations via Next.js BFF `POST /api/operations/:operation`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` settings hooks.
 */
export const SETTINGS_BFF_REDUCERS = [
  "create_organization",
  "update_organization",
  "upsert_organization_settings",
] as const;

export type SettingsBffReducerKey = (typeof SETTINGS_BFF_REDUCERS)[number];

const SETTINGS_HINT_OVERRIDES: Partial<
  Record<SettingsBffReducerKey, readonly string[]>
> = {
  upsert_organization_settings: ["organization-settings"],
  update_organization: ["organization"],
  create_organization: ["organizations"],
};

function settingsReducerHints(): Record<
  SettingsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<SettingsBffReducerKey, readonly string[]>;
  for (const k of SETTINGS_BFF_REDUCERS) {
    o[k] = SETTINGS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const SETTINGS_COMMAND_SUBSCRIPTION_HINTS: Record<
  SettingsBffReducerKey,
  readonly string[]
> = settingsReducerHints();

export function settingsCommandContract(
  reducer: SettingsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Settings reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: SETTINGS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
