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

/** A named set of search text and filters a user saved for a list, kept per browser. */
export interface SavedTableFilter {
  name: string
  search: string
  filters: Record<string, string>
}

export const MAX_SAVED_FILTERS = 20

export function savedFiltersStorageKey(listViewKey: string): string {
  return `${listViewKey}:saved-filters`
}

/** Reads stored saved filters, dropping malformed entries and filter keys the table no longer has. */
export function readSavedFilters(value: unknown, allowedKeys: ReadonlySet<string>): SavedTableFilter[] {
  if (!Array.isArray(value)) return []
  const result: SavedTableFilter[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (item === null || typeof item !== "object") continue
    const raw = item as { name?: unknown; search?: unknown; filters?: unknown }
    if (typeof raw.name !== "string" || !raw.name.trim() || seen.has(raw.name)) continue
    const filters: Record<string, string> = {}
    if (raw.filters !== null && typeof raw.filters === "object" && !Array.isArray(raw.filters)) {
      for (const [key, val] of Object.entries(raw.filters)) {
        if (allowedKeys.has(key) && typeof val === "string") filters[key] = val
      }
    }
    seen.add(raw.name)
    result.push({ name: raw.name, search: typeof raw.search === "string" ? raw.search : "", filters })
  }
  return result.slice(0, MAX_SAVED_FILTERS)
}

/** Drops "all" entries so a saved set only holds what actually narrows the list. */
export function activeFilterEntries(filters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== "__all__"))
}

/**
 * Adds or replaces (by name, case-insensitive) a saved filter. Returns the list unchanged when the
 * name is blank or there is nothing to save.
 */
export function upsertSavedFilter(
  saved: readonly SavedTableFilter[],
  entry: SavedTableFilter,
): SavedTableFilter[] {
  const name = entry.name.trim()
  const filters = activeFilterEntries(entry.filters)
  const search = entry.search.trim()
  if (!name || (Object.keys(filters).length === 0 && !search)) return [...saved]
  const next = saved.filter((item) => item.name.toLowerCase() !== name.toLowerCase())
  next.push({ name, search, filters })
  return next.slice(-MAX_SAVED_FILTERS)
}

export function removeSavedFilter(saved: readonly SavedTableFilter[], name: string): SavedTableFilter[] {
  return saved.filter((item) => item.name !== name)
}
