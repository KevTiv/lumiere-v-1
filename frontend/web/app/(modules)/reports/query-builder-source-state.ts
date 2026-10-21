import type { StoredDashboardSourceState } from "@lumiere/ui"

export type QueryBuilderSourceState =
  | "unselected"
  | "refreshing"
  | "error"
  | StoredDashboardSourceState["status"]

/**
 * Keep an unloaded source distinct from empty data. A current denied or failed
 * read takes precedence over cached rows, while per-source state preserves
 * loading, partial, unavailable, empty, and ready outcomes.
 */
export function queryBuilderSourceState(
  model: string,
  sourceState?: StoredDashboardSourceState,
  isRefreshing = false,
): QueryBuilderSourceState {
  if (!model) return "unselected"
  if (isRefreshing) return "refreshing"
  if (sourceState?.status === "loading") return "loading"
  return sourceState?.status ?? "loading"
}
