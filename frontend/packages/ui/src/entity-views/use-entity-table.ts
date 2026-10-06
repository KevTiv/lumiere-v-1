"use client"

import { useCallback, useMemo, useState } from "react"
import {
  useTable,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table"

import type { EntityColumn, EntityRow } from "../lib/entity-view-types"
import { getRowField } from "../lib/entity-row-values"
import {
  ALL_FILTER_VALUE,
  buildEngineColumns,
  entityTableFeatures,
  searchFilterFn,
} from "../lib/entity-table-engine"

export interface UseEntityTableOptions {
  /** The columns the user can see; the engine reads, sorts and filters by their keys. */
  columns: ReadonlyArray<Pick<EntityColumn, "key" | "label">>
  data: EntityRow[]
  /** Field that identifies a row, for selection and the default newest-first order. */
  rowKey: string
  pageSize: number
  /** Free-text search over these row keys. No keys, no search. */
  searchKeys?: readonly string[]
  search: string
  /** Column filters: row key → required value (case-insensitive). `__all__` and "" mean none. */
  filters: Readonly<Record<string, string>>
  /** Order shown until the user picks a column. Defaults to newest first (descending row key). */
  defaultSorting?: SortingState
}

const NO_KEYS: readonly string[] = []

function newestFirst(rowKey: string): SortingState {
  return [{ id: rowKey, desc: true }]
}

/**
 * Sorting, filtering, paging and selection for a record table, run by TanStack Table. Search and
 * filters come from the caller (they may be persisted or owned by the URL); sorting, the page and
 * the selection are kept here.
 *
 * With no column chosen, rows run newest first: read projections carry no creation time and
 * auto-increment ids only ever grow, so descending row key is creation order.
 */
export function useEntityTable({
  columns,
  data,
  rowKey,
  pageSize,
  searchKeys = NO_KEYS,
  search,
  filters,
  defaultSorting,
}: UseEntityTableOptions) {
  const [userSorting, setUserSorting] = useState<SortingState>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const activeFilters = useMemo(
    () =>
      Object.entries(filters)
        .filter(([, value]) => value && value !== ALL_FILTER_VALUE)
        .map(([id, value]) => ({ id, value })),
    [filters],
  )

  const fallbackSorting = useMemo(() => defaultSorting ?? newestFirst(rowKey), [defaultSorting, rowKey])

  // The default order's keys and each filter key need a column to read from.
  const engineColumns = useMemo(
    () =>
      buildEngineColumns(columns, [
        rowKey,
        ...fallbackSorting.map((sort) => sort.id),
        ...activeFilters.map((filter) => filter.id),
      ]),
    [columns, rowKey, fallbackSorting, activeFilters],
  )
  const globalFilterFn = useMemo(() => searchFilterFn(searchKeys), [searchKeys])

  const sorting = useMemo<SortingState>(
    () => (userSorting.length > 0 ? userSorting : fallbackSorting),
    [userSorting, fallbackSorting],
  )
  const pagination = useMemo<PaginationState>(() => ({ pageIndex, pageSize }), [pageIndex, pageSize])
  const globalFilter = searchKeys.length > 0 ? search : ""

  // Back to the first page whenever what is shown changes, set while rendering so a page that no
  // longer exists is never drawn.
  const resetKey = JSON.stringify([globalFilter, activeFilters, userSorting, data.length])
  const [previousResetKey, setPreviousResetKey] = useState(resetKey)
  if (previousResetKey !== resetKey) {
    setPreviousResetKey(resetKey)
    setPageIndex(0)
  }

  const onSortingChange = useCallback<OnChangeFn<SortingState>>((updater) => {
    // The default order is not a user choice: toggling is computed against what is on screen, and
    // only the result is remembered.
    setUserSorting((previous) => {
      const shown = previous.length > 0 ? previous : fallbackSorting
      return typeof updater === "function" ? updater(shown) : updater
    })
  }, [fallbackSorting])

  const onPaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const next =
        typeof updater === "function" ? updater({ pageIndex, pageSize }) : updater
      setPageIndex(next.pageIndex)
    },
    [pageIndex, pageSize],
  )

  const table = useTable({
    features: entityTableFeatures,
    columns: engineColumns,
    data,
    getRowId: (row, index) => String(getRowField(row, rowKey) ?? index),
    state: {
      sorting,
      pagination,
      rowSelection,
      globalFilter,
      columnFilters: activeFilters,
    },
    onSortingChange,
    onPaginationChange,
    onRowSelectionChange: setRowSelection,
    globalFilterFn,
    getColumnCanGlobalFilter: () => true,
    // Every control above is the user's: nothing resets the page behind their back.
    autoResetPageIndex: false,
    // Asc then desc, never back to the default order.
    enableSortingRemoval: false,
  })

  const filteredRows = table.getFilteredRowModel().rows
  const selectedRows = filteredRows.filter((row) => row.getIsSelected()).map((row) => row.original)
  const sortedRows = table.getPrePaginatedRowModel().rows.map((row) => row.original)
  const pageRows = table.getRowModel().rows
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = Math.min(pageIndex, pageCount - 1) + 1

  return {
    table,
    /** Rows after filtering and sorting, before paging (what an export should contain). */
    sortedRows,
    /** Rows on the current page. */
    pageRows,
    /** Selected rows that pass the current filters. */
    selectedRows,
    selectedCount: Object.values(rowSelection).filter(Boolean).length,
    /** 1-based. */
    currentPage,
    pageCount,
    setPage: (page: number) => setPageIndex(Math.max(0, page - 1)),
    /** The column the user sorted by, if they chose one. */
    sortedBy: userSorting[0],
    toggleSort: (key: string) => table.getColumn(key)?.toggleSorting(),
    clearSelection: () => setRowSelection({}),
  }
}
