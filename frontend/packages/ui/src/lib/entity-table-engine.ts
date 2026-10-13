import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnDef,
  type FilterFn,
  type SortFn,
} from "@tanstack/react-table"

import type { EntityColumn, EntityRow } from "./entity-view-types"
import { formatTimestampLike, getRowField } from "./entity-row-values"

/**
 * The behaviours every record table gets from TanStack Table: sorting, per-column and global
 * filtering, paging and row selection, all processed client-side. Module scope so the registry
 * stays stable between renders.
 */
export const entityTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})

export type EntityTableFeatures = typeof entityTableFeatures
export type EntityEngineColumn = ColumnDef<EntityTableFeatures, EntityRow>

/** Filter value meaning "no filter". */
export const ALL_FILTER_VALUE = "__all__"

/** Comparable text of a cell for filtering: unwraps enum (`{ tag }`) and option (`{ some }`) values. */
export function rowFilterValue(row: EntityRow, key: string): string {
  const val = row[key]
  if (val == null) return ""
  if (typeof val === "object" && !Array.isArray(val)) {
    const obj = val as EntityRow
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag
    if ("some" in obj) return rowFilterValue({ [key]: obj.some }, key)
  }
  return String(val)
}

/**
 * Ascending comparison of two cell values: timestamps by time, numbers numerically, everything
 * else as text with embedded numbers ordered naturally ("2" before "10"). Empty values are not
 * compared here; the column's `sortUndefined: "last"` keeps them last in either direction.
 */
export function compareCellValues(a: unknown, b: unknown): number {
  const dateA = formatTimestampLike(a)
  const dateB = formatTimestampLike(b)
  if (dateA && dateB) return dateA.getTime() - dateB.getTime()

  if (typeof a === "number" && typeof b === "number") return a - b

  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

const sortByCellValue: SortFn<EntityTableFeatures, EntityRow> = (rowA, rowB, columnId) =>
  compareCellValues(rowA.getValue(columnId), rowB.getValue(columnId))

/** A column filter: the row's cell equals the chosen value, ignoring case. */
const equalsFilterValue: FilterFn<EntityTableFeatures, EntityRow> = (row, columnId, filterValue) =>
  rowFilterValue(row.original, columnId).toLowerCase() === String(filterValue).toLowerCase()

/** True when any of `keys` contains `query` (case-insensitive). An empty query matches everything. */
export function matchesSearch(row: EntityRow, keys: readonly string[], query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return keys.some((key) => String(row[key] ?? "").toLowerCase().includes(needle))
}

/** Global filter over the given row keys, whatever column it is evaluated for. */
export function searchFilterFn(keys: readonly string[]): FilterFn<EntityTableFeatures, EntityRow> {
  return (row, _columnId, filterValue) => matchesSearch(row.original, keys, String(filterValue ?? ""))
}

function engineColumn(key: string, header: string): EntityEngineColumn {
  return {
    id: key,
    header,
    // Empty cells read as `undefined` so `sortUndefined` can keep them last.
    accessorFn: (row) => getRowField(row, key) ?? undefined,
    sortFn: sortByCellValue,
    sortUndefined: "last",
    sortDescFirst: false,
    // Which headers a user can click is the renderer's call; the engine must be able to sort by
    // any column, including the row key behind the default newest-first order.
    enableSorting: true,
    filterFn: equalsFilterValue,
    enableGlobalFilter: true,
  }
}

/**
 * Engine columns for a table: its display columns, plus a column for every other key the engine
 * reads (the row key that orders newest-first, and filter keys with no visible column such as an
 * `id` from a record link). Rendering stays with the caller; these only describe how to read,
 * sort and filter values.
 */
export function buildEngineColumns(
  columns: ReadonlyArray<Pick<EntityColumn, "key" | "label">>,
  extraKeys: readonly string[],
): EntityEngineColumn[] {
  const result = columns.map((column) => engineColumn(column.key, column.label))
  const seen = new Set(result.map((column) => column.id))
  for (const key of extraKeys) {
    if (seen.has(key)) continue
    seen.add(key)
    result.push(engineColumn(key, key))
  }
  return result
}
