"use client"

import { useState, useMemo, useEffect, type MouseEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "../lib/utils"
import type { EntityAction, EntityRow, EntityTableConfig } from "../lib/entity-view-types"
import { filterEntitySurface } from "../lib/entity-view-types"
import { useRBAC } from "../lib/rbac-context"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table"
import { Input } from "../components/input"
import { Button } from "../components/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import { TABLE_PAGE_SIZE, TablePager } from "../components/table-pager"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/empty"
import { Skeleton } from "../components/skeleton"
import { Checkbox } from "../components/checkbox"
import { showWorkflowToast } from "../lib/workflow-toast"
import { commitRecordListFor, rememberRecordList } from "../lib/record-list-context"
import { TooltipProvider } from "../components/tooltip"
import { Search, ArrowUp, ArrowDown, ArrowUpDown, Bookmark, Columns3, FileDown, Trash2, X, Inbox, SearchX, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../components/dropdown-menu"
import {
  radixSelectControlledValue,
  radixSelectItemValue,
  storedValueFromRadixSelect,
} from "../forms/utils/radix-select-empty-value"
import {
  formatEntityFieldValue,
  getRowField,
} from "../lib/entity-row-utils"
import { useEntityTableExport } from "./use-entity-table-export"
import { rowFilterValue } from "../lib/entity-table-engine"
import { useEntityTable } from "./use-entity-table"
import { InlineEditCell } from "./inline-edit-cell"
import {
  EMPTY_TABLE_VIEW,
  countRowsBy,
  groupRowsBy,
  readTableView,
  tableViewStorageKey,
  readSavedFilters,
  removeSavedFilter,
  sumRowsBy,
  savedFiltersStorageKey,
  toggleHiddenColumn,
  upsertSavedFilter,
  type EntityTableViewState,
  type SavedTableFilter,
} from "../lib/entity-table-view"
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover"

const PAGE_SIZE = TABLE_PAGE_SIZE
const LOADING_ROW_COUNT = 5

interface EntityTableProps {
  config: EntityTableConfig
  data: EntityRow[]
  /** Row key value highlighted as the ERP AI focus target */
  aiFocusRowKey?: string
  onRowClick?: (row: EntityRow) => void
  className?: string
  isLoading?: boolean
  /** Current URL or parent-owned filters, applied as transient overlays. */
  initialFilters?: Record<string, string>
  /** Clears a parent-owned filter at its source rather than persisting a local override. */
  onInitialFilterClear?: (key: string) => void
  /** Set false on sensitive lists to hide the Export action. Defaults to the config's `allowExport`, then true. */
  allowExport?: boolean
}

/** "Status" → "All statuses", "Priority" → "All priorities". */
export function allFilterLabel(label: string): string {
  const lower = label.toLowerCase()
  let plural: string
  if (/[^aeiou]y$/.test(lower)) plural = `${lower.slice(0, -1)}ies`
  else if (/(s|x|z|ch|sh)$/.test(lower)) plural = `${lower}es`
  else plural = `${lower}s`
  return `All ${plural}`
}

function readPersistedFilters(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        allowedKeys.has(entry[0]) && typeof entry[1] === "string",
    ),
  )
}

export function EntityTable({
  config,
  data,
  aiFocusRowKey,
  onRowClick,
  className,
  isLoading = false,
  initialFilters,
  onInitialFilterClear,
  allowExport,
}: EntityTableProps) {
  const { t } = useTranslation()
  const { checkPermission } = useRBAC()
  const [search, setSearch] = useState("")
  const [persistedFilters, setPersistedFilters] = useState<Record<string, string>>({})
  const [loadedListViewKey, setLoadedListViewKey] = useState<string | null>(null)
  const [pendingActionIds, setPendingActionIds] = useState<ReadonlySet<string>>(new Set())
  const persistedFilterKeys = useMemo(
    () => new Set(config.filters?.map((filter) => filter.key) ?? []),
    [config.filters],
  )

  useEffect(() => {
    const key = config.listViewKey
    if (!key || typeof window === "undefined") {
      setPersistedFilters({})
      setLoadedListViewKey(key ?? "")
      return
    }

    let savedFilters: Record<string, string> = {}
    try {
      const raw = window.localStorage.getItem(key)
      if (raw) {
        savedFilters = readPersistedFilters(JSON.parse(raw) as unknown, persistedFilterKeys)
      }
    } catch {
      // ignore corrupt saved filters
    }
    setPersistedFilters(savedFilters)
    setLoadedListViewKey(key)
  }, [config.listViewKey, persistedFilterKeys])

  useEffect(() => {
    const key = config.listViewKey
    if (!key || loadedListViewKey !== key || typeof window === "undefined") return
    try {
      window.localStorage.setItem(key, JSON.stringify(persistedFilters))
    } catch {
      // ignore quota errors
    }
  }, [config.listViewKey, loadedListViewKey, persistedFilters])

  const [savedFilters, setSavedFilters] = useState<SavedTableFilter[]>([])
  const [loadedSavedKey, setLoadedSavedKey] = useState<string | null>(null)
  const [newFilterName, setNewFilterName] = useState("")

  useEffect(() => {
    const key = config.listViewKey
    if (!key || typeof window === "undefined") {
      setSavedFilters([])
      setLoadedSavedKey(key ?? "")
      return
    }
    let saved: SavedTableFilter[] = []
    try {
      const raw = window.localStorage.getItem(savedFiltersStorageKey(key))
      if (raw) saved = readSavedFilters(JSON.parse(raw) as unknown, persistedFilterKeys)
    } catch {
      // ignore corrupt saved filters
    }
    setSavedFilters(saved)
    setLoadedSavedKey(key)
  }, [config.listViewKey, persistedFilterKeys])

  useEffect(() => {
    const key = config.listViewKey
    if (!key || loadedSavedKey !== key || typeof window === "undefined") return
    try {
      window.localStorage.setItem(savedFiltersStorageKey(key), JSON.stringify(savedFilters))
    } catch {
      // ignore quota errors
    }
  }, [config.listViewKey, loadedSavedKey, savedFilters])

  const filters = useMemo(
    () => ({ ...persistedFilters, ...initialFilters }),
    [initialFilters, persistedFilters],
  )

  const permittedColumns = useMemo(
    () => filterEntitySurface(config.columns, checkPermission),
    [config.columns, checkPermission],
  )
  const groupableFilters = useMemo(
    () => (config.filters ?? []).filter((filter) => (filter.options?.length ?? 0) > 0),
    [config.filters],
  )
  const [view, setView] = useState<EntityTableViewState>(EMPTY_TABLE_VIEW)
  const [loadedViewKey, setLoadedViewKey] = useState<string | null>(null)
  const permittedColumnKeys = useMemo(() => permittedColumns.map((col) => col.key), [permittedColumns])
  const groupKeys = useMemo(() => groupableFilters.map((filter) => filter.key), [groupableFilters])

  useEffect(() => {
    const key = config.listViewKey
    if (!key || typeof window === "undefined") {
      setView(EMPTY_TABLE_VIEW)
      setLoadedViewKey(key ?? "")
      return
    }
    let saved: EntityTableViewState = EMPTY_TABLE_VIEW
    try {
      const raw = window.localStorage.getItem(tableViewStorageKey(key))
      if (raw) saved = readTableView(JSON.parse(raw) as unknown, permittedColumnKeys, groupKeys)
    } catch {
      // ignore corrupt saved view
    }
    setView(saved)
    setLoadedViewKey(key)
  }, [config.listViewKey, permittedColumnKeys, groupKeys])

  useEffect(() => {
    const key = config.listViewKey
    if (!key || loadedViewKey !== key || typeof window === "undefined") return
    try {
      window.localStorage.setItem(tableViewStorageKey(key), JSON.stringify(view))
    } catch {
      // ignore quota errors
    }
  }, [config.listViewKey, loadedViewKey, view])

  const columns = useMemo(
    () => permittedColumns.filter((col) => !view.hiddenColumns.includes(col.key)),
    [permittedColumns, view.hiddenColumns],
  )
  const actions = useMemo(
    () => filterEntitySurface(config.actions, checkPermission),
    [config.actions, checkPermission],
  )

  const rowKey = config.rowKey ?? "id"

  // Filters with no toolbar control (e.g. `id` from a record link) would otherwise be invisible
  // and impossible to clear.
  const hiddenFilters = Object.entries(filters).filter(
    ([key, value]) => value && value !== "__all__" && !config.filters?.some((f) => f.key === key),
  )

  const {
    table,
    sortedRows: sorted,
    pageRows,
    selectedRows,
    selectedCount,
    currentPage,
    pageCount: totalPages,
    setPage,
    sortedBy,
    toggleSort,
    clearSelection,
  } = useEntityTable({
    columns,
    data,
    rowKey,
    pageSize: PAGE_SIZE,
    searchKeys: config.searchKeys,
    search,
    filters,
    groupBy: view.groupBy,
  })

  const groupFilter = groupableFilters.find((filter) => filter.key === view.groupBy)
  const groupCounts = useMemo(
    () => (view.groupBy ? countRowsBy(sorted, view.groupBy) : null),
    [sorted, view.groupBy],
  )
  const currencyColumns = useMemo(() => columns.filter((col) => col.type === "currency"), [columns])
  const groupSums = useMemo(() => {
    const groupKey = view.groupBy
    if (!groupKey) return null
    return new Map(currencyColumns.map((col) => [col.key, sumRowsBy(sorted, groupKey, col.key)] as const))
  }, [sorted, view.groupBy, currencyColumns])
  // Rows of the group on top of this page that began on the previous one.
  const continuedGroup = useMemo(() => {
    const groupKey = view.groupBy
    const start = (currentPage - 1) * PAGE_SIZE
    if (!groupKey || start === 0) return null
    const previous = sorted[start - 1]
    return previous ? rowFilterValue(previous, groupKey) : null
  }, [sorted, view.groupBy, currentPage])
  const renderGroups = useMemo(
    () => (view.groupBy ? groupRowsBy(pageRows, view.groupBy) : [{ value: "", rows: pageRows }]),
    [pageRows, view.groupBy],
  )
  const groupLabel = (value: string): string =>
    value === ""
      ? "None"
      : (groupFilter?.options?.find((option) => String(option.value) === value)?.label ?? value)

  const [pendingConfirm, setPendingConfirm] = useState<{
    action: EntityAction
    rows: EntityRow[]
  } | null>(null)

  /** Runs the action, keeps its button pending until it settles, and reports failures. */
  const executeAction = async (action: EntityAction, rows: EntityRow[]) => {
    if (pendingActionIds.has(action.id)) return
    setPendingActionIds((prev) => new Set(prev).add(action.id))
    try {
      await action.onClick(rows)
      if (action.successMessage) {
        showWorkflowToast({ kind: "success", title: action.successMessage })
      }
    } catch (error) {
      showWorkflowToast({
        kind: "error",
        title: `${action.label} failed`,
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPendingActionIds((prev) => {
        const next = new Set(prev)
        next.delete(action.id)
        return next
      })
    }
  }

  const runAction = (action: EntityAction) => {
    if (action.confirm) setPendingConfirm({ action, rows: selectedRows })
    else void executeAction(action, selectedRows)
  }

  const hasActions = actions.length > 0
  // Row actions only appear once rows are selected; inapplicable ones stay
  // visible but disabled so the selection's state is still explained.
  const selectionActions = actions.filter((action) => action.requiresSelection)
  const renderActionButton = (action: EntityAction) => {
    const Icon = action.icon
    const isPending = pendingActionIds.has(action.id)
    const needsSingleRow =
      action.requiresSelection === true &&
      (action.selection ?? "single") === "single" &&
      selectedRows.length > 1
    return (
      <Button
        key={action.id}
        variant={action.variant ?? "outline"}
        size="sm"
        disabled={
          isPending ||
          needsSingleRow ||
          (selectedRows.length > 0 && action.isApplicable?.(selectedRows) === false)
        }
        title={needsSingleRow ? "Select a single record to use this action" : undefined}
        aria-busy={isPending || undefined}
        onClick={() => runAction(action)}
        data-testid={`entity-action-${action.id}`}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          Icon && <Icon className="mr-2 h-4 w-4" />
        )}
        {action.label}
      </Button>
    )
  }
  const selectionToggleOnRowClick =
    config.rowSelectionToggleOnClick ??
    (hasActions && actions.some((a) => a.requiresSelection === true))
  const rowsAreInteractive = Boolean(onRowClick || selectionToggleOnRowClick)
  // Rows can be ticked individually, and the whole page at once, whenever the table has actions
  // that run on a selection.
  const showSelectColumn = selectionActions.length > 0
  const selectColumnCount = showSelectColumn ? 1 : 0

  const activateRow = (tableRow: (typeof pageRows)[number]) => {
    // A click on the only selected row keeps it selected; untick it with its checkbox.
    if (selectionToggleOnRowClick && !(selectedCount === 1 && tableRow.getIsSelected())) {
      tableRow.toggleSelected()
    }
    onRowClick?.(tableRow.original)
  }

  const handleSort = (columnKey: string, sortable?: boolean) => {
    if (!sortable) return
    toggleSort(columnKey)
  }

  const getSortIcon = (columnKey: string, sortable?: boolean) => {
    if (!sortable) return null
    if (sortedBy?.id !== columnKey) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return !sortedBy.desc ? (
      <ArrowUp className="ml-1 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-1 h-4 w-4" />
    )
  }

  // Rows exist but the search/filters hide them all: say so instead of "empty".
  const filteredOut = data.length > 0 && sorted.length === 0
  const emptyTitle = filteredOut
    ? "No matching records"
    : (config.emptyState?.title ?? config.emptyMessage ?? "No records yet")
  const emptyDescription = filteredOut
    ? "Try a different search or clear the filters."
    : config.emptyState?.description
  const emptyIcon = filteredOut ? (
    <SearchX />
  ) : (
    config.emptyState?.icon ?? <Inbox />
  )

  // Opening a record from this list (a name link, or a row whose sheet has an Open button) files
  // the keys now shown, in order, so the record page's previous / next follow this list.
  const publishRecordList = (event: MouseEvent<HTMLElement>) => {
    try {
      const ids = sorted.map((row) => String(row[rowKey] ?? ""))
      rememberRecordList(ids)
      const anchor = (event.target as Element | null)?.closest?.("a[href]")
      commitRecordListFor(anchor?.getAttribute("href") ?? undefined, ids)
    } catch {
      // Navigation must never depend on this.
    }
  }

  // Selected rows go out in the order shown; with no selection, every row matching the search and filters.
  const selectedSet = new Set(selectedRows)
  const { exportCsv } = useEntityTableExport({
    columns,
    selectedRows: selectedSet.size > 0 ? sorted.filter((row) => selectedSet.has(row)) : [],
    filteredRows: sorted,
    listViewKey: config.listViewKey,
  })
  const exportLabel = t("common.entityView.export", { defaultValue: "Export" })
  const canExport = (allowExport ?? config.allowExport ?? true) && columns.some((col) => !col.sensitive)

  return (
    <TooltipProvider>
      <div
        className={cn("space-y-4", className)}
        data-testid="entity-table"
        onClickCapture={publishRecordList}
      >
        {hiddenFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="entity-active-filters">
            {hiddenFilters.map(([key, value]) => (
              <Button
                key={key}
                variant="secondary"
                size="sm"
                aria-label={`Clear filter ${key}`}
                data-testid={`entity-active-filter-${key}`}
                disabled={Object.hasOwn(initialFilters ?? {}, key) && !onInitialFilterClear}
                onClick={() => {
                  if (Object.hasOwn(initialFilters ?? {}, key)) {
                    onInitialFilterClear?.(key)
                    return
                  }
                  setPersistedFilters((prev) => {
                    const { [key]: _removed, ...rest } = prev
                    return rest
                  })
                }}
              >
                {key}: {value}
                <X className="ml-2 h-3 w-3" />
              </Button>
            ))}
          </div>
        )}
        {(config.searchable || (config.filters?.length ?? 0) > 0 || hasActions) && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
            {config.searchable && (
              <div className="relative min-w-48 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search records"
                  placeholder={config.searchPlaceholder ?? "Search…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            )}
            {config.filters?.map((f) => {
              const raw = filters[f.key] ?? "__all__"
              const selectValue =
                raw === "__all__" ? "__all__" : radixSelectControlledValue(raw, f.options)
              return (
                <Select
                  key={f.key}
                  value={selectValue}
                  disabled={Object.hasOwn(initialFilters ?? {}, f.key) && !onInitialFilterClear}
                  onValueChange={(val) => {
                    if (Object.hasOwn(initialFilters ?? {}, f.key)) {
                      onInitialFilterClear?.(f.key)
                    }
                    setPersistedFilters((prev) => ({
                      ...prev,
                      [f.key]: val === "__all__" ? "__all__" : storedValueFromRadixSelect(val),
                    }))
                  }}
                >
                  <SelectTrigger className="w-40" aria-label={f.label}>
                    <SelectValue placeholder={f.placeholder ?? f.label} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{allFilterLabel(f.label)}</SelectItem>
                    {f.options?.map((o, idx) => (
                      <SelectItem
                        key={`${radixSelectItemValue(o, idx)}-${idx}`}
                        value={radixSelectItemValue(o, idx)}
                      >
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            })}
            <div className="ml-auto flex items-center gap-2">
              {config.listViewKey && ((config.filters?.length ?? 0) > 0 || config.searchable) && (
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button variant="outline" size="sm" aria-label="Saved filters" data-testid="entity-saved-filters" />
                    }
                  >
                    <Bookmark className="mr-2 h-4 w-4" />
                    Saved filters
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 space-y-3">
                    {savedFilters.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No saved filters yet. Set a search or filters, then save them under a name.
                      </p>
                    ) : (
                      <ul className="space-y-1" data-testid="entity-saved-filter-list">
                        {savedFilters.map((saved) => (
                          <li key={saved.name} className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-w-0 flex-1 justify-start truncate"
                              data-testid={`entity-saved-filter-apply-${saved.name}`}
                              onClick={() => {
                                setSearch(saved.search)
                                setPersistedFilters((prev) => ({
                                  ...Object.fromEntries(Object.keys(prev).map((key) => [key, "__all__"])),
                                  ...saved.filters,
                                }))
                              }}
                            >
                              {saved.name}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete saved filter ${saved.name}`}
                              data-testid={`entity-saved-filter-delete-${saved.name}`}
                              onClick={() => setSavedFilters((prev) => removeSavedFilter(prev, saved.name))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        setSavedFilters((prev) =>
                          upsertSavedFilter(prev, { name: newFilterName, search, filters }),
                        )
                        setNewFilterName("")
                      }}
                    >
                      <Input
                        aria-label="Name for the current filters"
                        placeholder="Name for current filters"
                        value={newFilterName}
                        onChange={(event) => setNewFilterName(event.target.value)}
                        data-testid="entity-saved-filter-name"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!newFilterName.trim()}
                        data-testid="entity-saved-filter-save"
                      >
                        Save
                      </Button>
                    </form>
                  </PopoverContent>
                </Popover>
              )}
              {groupableFilters.length > 0 && (
                <Select
                  value={view.groupBy ?? "__none__"}
                  onValueChange={(val) =>
                    setView((prev) => ({ ...prev, groupBy: val === "__none__" ? null : String(val) }))
                  }
                >
                  <SelectTrigger className="w-40" aria-label="Group by" data-testid="entity-group-by">
                    <SelectValue placeholder="Group by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No grouping</SelectItem>
                    {groupableFilters.map((filter) => (
                      <SelectItem key={filter.key} value={filter.key}>
                        Group by {filter.label.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {permittedColumns.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" aria-label="Choose columns" data-testid="entity-columns">
                      <Columns3 className="mr-2 h-4 w-4" />
                      Columns
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    {permittedColumns.map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={!view.hiddenColumns.includes(col.key)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() =>
                          setView((prev) => ({
                            ...prev,
                            hiddenColumns: toggleHiddenColumn(prev.hiddenColumns, col.key, permittedColumnKeys),
                          }))
                        }
                        data-testid={`entity-column-toggle-${col.key}`}
                      >
                        {col.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {canExport && sorted.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  aria-label={exportLabel}
                  data-testid="entity-table-export"
                >
                  <FileDown className="mr-2 h-4 w-4" />
                  {exportLabel}
                </Button>
              )}
              {actions.filter((action) => !action.requiresSelection).map(renderActionButton)}
            </div>
          </div>
        )}

        {selectedRows.length > 0 && selectionActions.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2"
            data-testid="entity-selection-actions"
          >
            <span className="mr-1 text-sm font-medium text-foreground">
              {selectedRows.length} selected
            </span>
            {selectionActions.map(renderActionButton)}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={clearSelection}
              data-testid="entity-selection-clear"
            >
              Clear selection
            </Button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <Table>
            <TableHeader className="bg-muted/25">
              <TableRow>
                {showSelectColumn && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all rows on this page"
                      data-testid="entity-select-all"
                      checked={table.getIsAllPageRowsSelected()}
                      indeterminate={table.getIsSomePageRowsSelected()}
                      disabled={pageRows.length === 0}
                      onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
                    />
                  </TableHead>
                )}
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={cn(
                      col.width,
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.sortable && "select-none",
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center font-medium",
                          col.align === "right" && "ml-auto",
                          col.align === "center" && "mx-auto",
                        )}
                        onClick={() => handleSort(col.key, col.sortable)}
                        aria-sort={
                          sortedBy?.id === col.key
                            ? sortedBy.desc
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        {col.label}
                        {getSortIcon(col.key, col.sortable)}
                      </button>
                    ) : (
                      col.label
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: LOADING_ROW_COUNT }, (_, rowIndex) => (
                  <TableRow key={`loading-${rowIndex}`}>
                    {showSelectColumn && (
                      <TableCell className="w-10">
                        <Skeleton className="h-4 w-4" />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <Skeleton className="h-4 w-full max-w-32" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={Math.max(columns.length + selectColumnCount, 1)} className="p-0">
                    <Empty className="border-0 py-12">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">{emptyIcon}</EmptyMedia>
                        <EmptyTitle>{emptyTitle}</EmptyTitle>
                        {emptyDescription ? <EmptyDescription>{emptyDescription}</EmptyDescription> : null}
                      </EmptyHeader>
                      {config.emptyState?.actionLabel && config.emptyState.onAction ? (
                        <EmptyContent>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={config.emptyState.onAction}
                          >
                            {config.emptyState.actionLabel}
                          </Button>
                        </EmptyContent>
                      ) : null}
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                renderGroups.flatMap((group) => [
                  view.groupBy ? (
                    <TableRow key={`group-${group.value}`} className="bg-muted/40 hover:bg-muted/40" data-testid="entity-group-row">
                      <TableCell colSpan={selectColumnCount + 1} className="py-2 text-sm font-medium">
                        {groupLabel(group.value)}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {groupCounts?.get(group.value) ?? group.rows.length}
                          {group.value === continuedGroup ? " · continued" : ""}
                        </span>
                      </TableCell>
                      {columns.slice(1).map((col) => {
                        const total = groupSums?.get(col.key)?.get(group.value)
                        return (
                          <TableCell
                            key={col.key}
                            className={cn("py-2 text-sm font-medium", col.align === "right" && "text-right")}
                            data-testid={total === undefined ? undefined : `entity-group-sum-${col.key}`}
                          >
                            {total === undefined ? null : formatEntityFieldValue(total, col.type)}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ) : null,
                  ...group.rows.map((tableRow) => {
                  const row = tableRow.original
                  const key = tableRow.id
                  const isSelected = tableRow.getIsSelected()
                  const isAiFocused =
                    aiFocusRowKey != null && aiFocusRowKey !== "" && key === aiFocusRowKey
                  return (
                    <TableRow
                      key={key}
                      data-testid={`entity-row-${key}`}
                      data-ai-focus={isAiFocused ? "true" : undefined}
                      onClick={rowsAreInteractive ? () => activateRow(tableRow) : undefined}
                      onKeyDown={(event) => {
                        if (!rowsAreInteractive) return
                        // Keys pressed on a control inside the row (the checkbox, a link) are that
                        // control's own.
                        if (event.target !== event.currentTarget) return
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          activateRow(tableRow)
                        }
                      }}
                      tabIndex={rowsAreInteractive ? 0 : undefined}
                      aria-selected={selectionToggleOnRowClick ? isSelected : undefined}
                      data-state={isSelected ? "selected" : undefined}
                      className={cn(
                        rowsAreInteractive &&
                          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/20",
                        isAiFocused && "bg-primary/10 ring-1 ring-inset ring-primary/40",
                        isSelected && !isAiFocused && "bg-muted/50",
                      )}
                    >
                      {showSelectColumn && (
                        <TableCell className="w-10" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            aria-label="Select row"
                            data-testid={`entity-select-row-${key}`}
                            checked={isSelected}
                            onCheckedChange={(checked) => tableRow.toggleSelected(checked === true)}
                          />
                        </TableCell>
                      )}
                      {columns.map((col) => {
                        const value = getRowField(row, col.key)
                        return (
                          <TableCell
                            key={col.key}
                            className={cn(
                              col.align === "right" && "text-right",
                              col.align === "center" && "text-center",
                            )}
                          >
                            {(() => {
                              const content = col.render
                                ? col.render(value, row)
                                : formatEntityFieldValue(
                                    value,
                                    col.type,
                                    col.badgeVariants,
                                    col.badgeLabels,
                                  )
                              return col.inlineEdit ? (
                                <InlineEditCell
                                  edit={col.inlineEdit}
                                  row={row}
                                  columnKey={col.key}
                                  label={col.label}
                                  value={value}
                                >
                                  {content}
                                </InlineEditCell>
                              ) : (
                                content
                              )
                            })()}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                  }),
                ])
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading ? (
          <TablePager
            currentPage={currentPage}
            totalPages={totalPages}
            setPage={setPage}
            total={sorted.length}
            pageSize={PAGE_SIZE}
            showRange={false}
          />
        ) : null}

        {!isLoading && sorted.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {sorted.length > PAGE_SIZE
              ? `${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, sorted.length)} of ${sorted.length}`
              : `${sorted.length} of ${data.length}`}{" "}
            record{sorted.length !== 1 ? "s" : ""}
            {selectedCount > 0 && ` · ${selectedCount} selected`}
          </p>
        )}
      </div>
      <AlertDialog open={pendingConfirm != null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent data-testid="entity-action-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.action.confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {typeof pendingConfirm?.action.confirm?.description === "function"
                ? pendingConfirm.action.confirm.description(pendingConfirm.rows)
                : pendingConfirm?.action.confirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{pendingConfirm?.action.confirm?.cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConfirm) void executeAction(pendingConfirm.action, pendingConfirm.rows)
              }}
            >
              {pendingConfirm?.action.confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
