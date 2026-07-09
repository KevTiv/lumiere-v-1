"use client"

import { useState, useMemo, useEffect } from "react"
import { cn } from "../lib/utils"
import type { EntityTableConfig } from "../lib/entity-view-types"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/pagination"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/empty"
import { Skeleton } from "../components/skeleton"
import { TooltipProvider } from "../components/tooltip"
import { Search, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import {
  radixSelectControlledValue,
  radixSelectItemValue,
  storedValueFromRadixSelect,
} from "../forms/utils/radix-select-empty-value"
import {
  formatEntityFieldValue,
  formatTimestampLike,
  getRowField,
} from "../lib/entity-row-utils"

const PAGE_SIZE = 25
const LOADING_ROW_COUNT = 5

type SortDirection = "asc" | "desc"

interface EntityTableProps {
  config: EntityTableConfig
  data: Record<string, unknown>[]
  /** Row key value highlighted as the ERP AI focus target */
  aiFocusRowKey?: string
  onRowClick?: (row: Record<string, unknown>) => void
  className?: string
  isLoading?: boolean
  /** URL or parent-provided filters applied on mount (e.g. chart drill-down). */
  initialFilters?: Record<string, string>
}

function rowFilterValue(row: Record<string, unknown>, key: string): string {
  const val = row[key]
  if (val == null) return ""
  if (typeof val === "object" && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag
    if ("some" in obj) return rowFilterValue({ [key]: obj.some }, key)
  }
  return String(val)
}

function compareRowValues(a: unknown, b: unknown, direction: SortDirection): number {
  const mul = direction === "asc" ? 1 : -1
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  const dateA = formatTimestampLike(a)
  const dateB = formatTimestampLike(b)
  if (dateA && dateB) return mul * (dateA.getTime() - dateB.getTime())

  if (typeof a === "number" && typeof b === "number") return mul * (a - b)

  return mul * String(a).localeCompare(String(b), undefined, { numeric: true })
}

function paginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const items: Array<number | "ellipsis"> = [1]
  if (currentPage > 3) items.push("ellipsis")

  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)
  for (let page = start; page <= end; page += 1) items.push(page)

  if (currentPage < totalPages - 2) items.push("ellipsis")
  items.push(totalPages)
  return items
}

export function EntityTable({
  config,
  data,
  aiFocusRowKey,
  onRowClick,
  className,
  isLoading = false,
  initialFilters,
}: EntityTableProps) {
  const { checkPermission } = useRBAC()
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (initialFilters && Object.keys(initialFilters).length > 0) {
      setFilters((prev) => ({ ...prev, ...initialFilters }))
      return
    }

    const key = config.listViewKey
    if (!key || typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        setFilters(parsed as Record<string, string>)
      }
    } catch {
      // ignore corrupt saved filters
    }
  }, [config.listViewKey, initialFilters])

  useEffect(() => {
    const key = config.listViewKey
    if (!key || typeof window === "undefined") return
    try {
      window.localStorage.setItem(key, JSON.stringify(filters))
    } catch {
      // ignore quota errors
    }
  }, [config.listViewKey, filters])

  useEffect(() => {
    setPage(1)
  }, [search, filters, sortKey, sortDirection, data.length])

  const columns = useMemo(
    () => filterEntitySurface(config.columns, checkPermission),
    [config.columns, checkPermission],
  )
  const actions = useMemo(
    () => filterEntitySurface(config.actions, checkPermission),
    [config.actions, checkPermission],
  )

  const rowKey = config.rowKey ?? "id"

  const filtered = useMemo(() => {
    let rows = data

    if (search && config.searchKeys?.length) {
      const q = search.toLowerCase()
      rows = rows.filter((row) =>
        config.searchKeys!.some((k) => String(row[k] ?? "").toLowerCase().includes(q)),
      )
    }

    for (const [key, val] of Object.entries(filters)) {
      if (val && val !== "__all__") {
        rows = rows.filter(
          (row) => rowFilterValue(row, key).toLowerCase() === val.toLowerCase(),
        )
      }
    }

    return rows
  }, [data, search, filters, config.searchKeys])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    return [...filtered].sort((a, b) =>
      compareRowValues(getRowField(a, sortKey), getRowField(b, sortKey), sortDirection),
    )
  }, [filtered, sortKey, sortDirection])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return sorted.slice(start, start + PAGE_SIZE)
  }, [sorted, currentPage])

  const selectedRows = filtered.filter((row) =>
    selectedKeys.has(String(getRowField(row, rowKey) ?? "")),
  )

  const toggleRow = (key: string) => {
    setSelectedKeys((prev) => {
      if (prev.size === 1 && prev.has(key)) return prev
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const hasActions = actions.length > 0
  const selectionToggleOnRowClick =
    config.rowSelectionToggleOnClick ??
    (hasActions && actions.some((a) => a.requiresSelection === true))
  const rowsAreInteractive = Boolean(onRowClick || selectionToggleOnRowClick)

  const activateRow = (key: string, row: Record<string, unknown>) => {
    if (selectionToggleOnRowClick) toggleRow(key)
    onRowClick?.(row)
  }

  const handleSort = (columnKey: string, sortable?: boolean) => {
    if (!sortable) return
    if (sortKey === columnKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(columnKey)
    setSortDirection("asc")
  }

  const getSortIcon = (columnKey: string, sortable?: boolean) => {
    if (!sortable) return null
    if (sortKey !== columnKey) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-1 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-1 h-4 w-4" />
    )
  }

  const emptyTitle =
    config.emptyState?.title ?? config.emptyMessage ?? "No records found."

  return (
    <TooltipProvider>
      <div className={cn("space-y-4", className)} data-testid="entity-table">
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
                  onValueChange={(val) =>
                    setFilters((prev) => ({
                      ...prev,
                      [f.key]: val === "__all__" ? "__all__" : storedValueFromRadixSelect(val),
                    }))
                  }
                >
                  <SelectTrigger className="w-40" aria-label={f.label}>
                    <SelectValue placeholder={f.placeholder ?? f.label} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All {f.label}s</SelectItem>
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
              {actions.map((action) => {
                const Icon = action.icon
                return (
                  <Button
                    key={action.id}
                    variant={action.variant ?? "outline"}
                    size="sm"
                    disabled={action.requiresSelection && selectedRows.length === 0}
                    onClick={() => action.onClick(selectedRows)}
                    data-testid={`entity-action-${action.id}`}
                  >
                    {Icon && <Icon className="mr-2 h-4 w-4" />}
                    {action.label}
                  </Button>
                )
              })}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <Table>
            <TableHeader className="bg-muted/25">
              <TableRow>
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
                          sortKey === col.key
                            ? sortDirection === "asc"
                              ? "ascending"
                              : "descending"
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
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <Skeleton className="h-4 w-full max-w-32" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={Math.max(columns.length, 1)} className="p-0">
                    <Empty className="border-0 py-12">
                      <EmptyHeader>
                        {config.emptyState?.icon ? (
                          <EmptyMedia variant="icon">{config.emptyState.icon}</EmptyMedia>
                        ) : null}
                        <EmptyTitle>{emptyTitle}</EmptyTitle>
                        {config.emptyState?.description ? (
                          <EmptyDescription>{config.emptyState.description}</EmptyDescription>
                        ) : null}
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
                paginated.map((row, i) => {
                  const key = String(getRowField(row, rowKey) ?? i)
                  const isSelected = selectedKeys.has(key)
                  const isAiFocused =
                    aiFocusRowKey != null && aiFocusRowKey !== "" && key === aiFocusRowKey
                  return (
                    <TableRow
                      key={key}
                      data-testid={`entity-row-${key}`}
                      data-ai-focus={isAiFocused ? "true" : undefined}
                      onClick={rowsAreInteractive ? () => activateRow(key, row) : undefined}
                      onKeyDown={(event) => {
                        if (!rowsAreInteractive) return
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          activateRow(key, row)
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
                            {col.render
                              ? col.render(value, row)
                              : formatEntityFieldValue(
                                  value,
                                  col.type,
                                  col.badgeVariants,
                                  col.badgeLabels,
                                )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading && sorted.length > PAGE_SIZE ? (
          <Pagination className="justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    if (currentPage > 1) setPage(currentPage - 1)
                  }}
                  className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined}
                />
              </PaginationItem>
              {paginationItems(currentPage, totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      href="#"
                      isActive={item === currentPage}
                      onClick={(event) => {
                        event.preventDefault()
                        setPage(item)
                      }}
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    if (currentPage < totalPages) setPage(currentPage + 1)
                  }}
                  className={
                    currentPage === totalPages ? "pointer-events-none opacity-50" : undefined
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}

        {!isLoading && sorted.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {sorted.length > PAGE_SIZE
              ? `${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, sorted.length)} of ${sorted.length}`
              : `${sorted.length} of ${data.length}`}{" "}
            record{sorted.length !== 1 ? "s" : ""}
            {selectedKeys.size > 0 && ` · ${selectedKeys.size} selected`}
          </p>
        )}
      </div>
    </TooltipProvider>
  )
}
