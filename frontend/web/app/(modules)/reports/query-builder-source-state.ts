export type QueryBuilderSourceState = "unselected" | "loading" | "empty" | "ready"

/**
 * Keep an unloaded report source distinct from a successfully loaded source
 * with no rows. Query failures are intentionally not represented here: the
 * shared data-source hook must expose them before this view can render them
 * truthfully.
 */
export function queryBuilderSourceState(
  model: string,
  isLoading: boolean,
  rowCount: number,
): QueryBuilderSourceState {
  if (!model) return "unselected"
  if (isLoading) return "loading"
  return rowCount === 0 ? "empty" : "ready"
}
