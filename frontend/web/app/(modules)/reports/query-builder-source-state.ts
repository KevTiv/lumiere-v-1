import type { StoredDashboardSourceState } from "@lumiere/ui"

export type QueryBuilderSourceState = "unselected" | StoredDashboardSourceState["status"]

/**
 * Keep an unloaded report source distinct from a successfully loaded source
 * with no rows. Preserve the hook's denied, unavailable, and partial states.
 */
export function queryBuilderSourceState(
  model: string,
  sourceState?: StoredDashboardSourceState,
): QueryBuilderSourceState {
  if (!model) return "unselected"
  return sourceState?.status ?? "loading"
}
