import type { EntityRow } from "./entity-view-types"
import { rowFilterValue } from "./entity-table-engine"

/** What a user chose about how a list looks, kept per browser (not synced to the server). */
export interface EntityTableViewState {
  hiddenColumns: string[]
  groupBy: string | null
}

export const EMPTY_TABLE_VIEW: EntityTableViewState = { hiddenColumns: [], groupBy: null }

/** Storage key of the view state, next to the list's persisted filters. */
export function tableViewStorageKey(listViewKey: string): string {
  return `${listViewKey}:view`
}

/** Reads stored view state, keeping only columns / group keys the table still has. */
export function readTableView(
  value: unknown,
  columnKeys: readonly string[],
  groupKeys: readonly string[],
): EntityTableViewState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return EMPTY_TABLE_VIEW
  const raw = value as { hiddenColumns?: unknown; groupBy?: unknown }
  const known = new Set(columnKeys)
  const hiddenColumns = Array.isArray(raw.hiddenColumns)
    ? raw.hiddenColumns.filter((key): key is string => typeof key === "string" && known.has(key))
    : []
  // A table always shows at least one column.
  const safeHidden = hiddenColumns.length >= columnKeys.length ? [] : hiddenColumns
  const groupBy =
    typeof raw.groupBy === "string" && groupKeys.includes(raw.groupBy) ? raw.groupBy : null
  return { hiddenColumns: safeHidden, groupBy }
}

/** Toggles a column; the last visible column cannot be hidden. */
export function toggleHiddenColumn(
  hidden: readonly string[],
  columnKey: string,
  allKeys: readonly string[],
): string[] {
  if (hidden.includes(columnKey)) return hidden.filter((key) => key !== columnKey)
  if (allKeys.filter((key) => !hidden.includes(key)).length <= 1) return [...hidden]
  return [...hidden, columnKey]
}

export interface RowGroup<T> {
  value: string
  rows: T[]
}

/** Splits rows into groups by a field, in order of first appearance. Empty values group as "". */
export function groupRowsBy<T extends { original: EntityRow }>(rows: readonly T[], key: string): RowGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const value = rowFilterValue(row.original, key)
    const bucket = groups.get(value)
    if (bucket) bucket.push(row)
    else groups.set(value, [row])
  }
  return [...groups].map(([value, grouped]) => ({ value, rows: grouped }))
}

/** How many of all rows fall under each value of a field. */
export function countRowsBy(rows: readonly EntityRow[], key: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = rowFilterValue(row, key)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}
