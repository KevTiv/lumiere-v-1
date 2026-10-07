"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import type { TFunction } from "i18next"
import { BarChart3, LayoutGrid, List } from "lucide-react"
import { cn } from "../lib/utils"
import type {
  EntityDetailConfig,
  EntityPermissioned,
  EntityPivotConfig,
  EntityTableBoardViewConfig,
  EntityTableConfig,
  EntityViewConfig,
} from "../lib/entity-view-types"
import { filterEntitySurface } from "../lib/entity-view-types"
import type { KanbanColumnDef, KanbanMoveHandler } from "../lib/kanban-board-types"
import { useRBAC } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"
import { EntityDetail } from "./entity-detail"
import { EntityBoardView } from "./entity-board"
import { EntityPivotView } from "./entity-pivot"
import { ALL_FILTER_VALUE, matchesSearch, rowFilterValue } from "../lib/entity-table-engine"
import { formatEntityFieldValue, getRowField, resolveCurrencyCode } from "../lib/entity-row-utils"
import { Input } from "../components/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Button } from "../components/button"

interface EntityViewProps {
  config: EntityViewConfig
  data?: Record<string, unknown>[]
  record?: Record<string, unknown>
  useCard?: boolean
  /** Rendered on the title row, right-aligned (e.g. the tab's create button). */
  headerAction?: ReactNode
  aiFocusRowKey?: string
  onRowClick?: (row: Record<string, unknown>) => void
  className?: string
  boardColumns?: KanbanColumnDef[]
  onBoardMove?: KanbanMoveHandler
  boardFilterItem?: (row: Record<string, unknown>) => boolean
  /** Show skeleton rows in table view while subscription data is loading. */
  isLoading?: boolean
  /** Current URL or parent-owned filters, applied as transient overlays. */
  initialFilters?: Record<string, string>
  onInitialFilterClear?: (key: string) => void
}

export function useEntitySurfaceFilter<T extends EntityPermissioned>(
  items: T[] | undefined,
): T[] {
  const { checkPermission } = useRBAC()
  return useMemo(
    () => filterEntitySurface(items, checkPermission),
    [items, checkPermission],
  )
}

export function useScopedEntityTableConfig(config: EntityTableConfig): EntityTableConfig {
  const columns = useEntitySurfaceFilter(config.columns)
  const actions = useEntitySurfaceFilter(config.actions)
  return useMemo(
    () => ({
      ...config,
      // Currency columns that name a row currency field format with that row's currency.
      columns: columns.map((column) =>
        column.type === "currency" && column.currencyKey && !column.render
          ? {
              ...column,
              render: (value: unknown, row: Record<string, unknown>) =>
                formatEntityFieldValue(
                  value,
                  "currency",
                  undefined,
                  undefined,
                  resolveCurrencyCode(getRowField(row, column.currencyKey!)),
                ),
            }
          : column,
      ),
      actions: actions.length > 0 ? actions : undefined,
    }),
    [config, columns, actions],
  )
}

export function useScopedEntityDetailConfig(config: EntityDetailConfig): EntityDetailConfig {
  const { checkPermission } = useRBAC()
  return useMemo(
    () => ({
      ...config,
      sections: config.sections
        .map((section) => ({
          ...section,
          fields: filterEntitySurface(section.fields, checkPermission),
        }))
        .filter((section) => section.fields.length > 0),
    }),
    [config, checkPermission],
  )
}

export type EntitySurfaceMode = "table" | "board" | "pivot"

const surfaceModeStorageKey = (configId: string) => `lumiere:entity-view-mode:${configId}`

export interface StoredSurfaceState {
  mode: EntitySurfaceMode
  /** Pivot "columns by" key, when one was chosen. */
  columnKey?: string
}

/**
 * The remembered mode of a list (and its pivot "columns by" key). The entry is the plain mode
 * name, or JSON `{ mode, columnKey }` once a pivot column grouping was chosen.
 */
export function readStoredSurfaceState(
  configId: string,
  allowed: readonly EntitySurfaceMode[] = ["table", "board"],
): StoredSurfaceState | null {
  try {
    const stored = window.localStorage.getItem(surfaceModeStorageKey(configId))
    if (!stored) return null
    let mode: unknown = stored
    let columnKey: unknown
    if (stored.startsWith("{")) {
      const parsed = JSON.parse(stored) as { mode?: unknown; columnKey?: unknown }
      mode = parsed.mode
      columnKey = parsed.columnKey
    }
    const found = allowed.find((candidate) => candidate === mode)
    if (!found) return null
    return typeof columnKey === "string" && columnKey ? { mode: found, columnKey } : { mode: found }
  } catch {
    return null
  }
}

export function readStoredSurfaceMode(
  configId: string,
  allowed: readonly EntitySurfaceMode[] = ["table", "board"],
): EntitySurfaceMode | null {
  return readStoredSurfaceState(configId, allowed)?.mode ?? null
}

export function storeSurfaceMode(configId: string, mode: EntitySurfaceMode, columnKey?: string) {
  try {
    window.localStorage.setItem(
      surfaceModeStorageKey(configId),
      columnKey ? JSON.stringify({ mode, columnKey }) : mode,
    )
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
}

/** Board columns from the table's group column badge labels (read-only boards). */
function deriveBoardColumns(
  table: EntityTableConfig,
  groupKey: string,
): KanbanColumnDef[] {
  const labels = table.columns.find((column) => column.key === groupKey)?.badgeLabels
  if (!labels) return []
  return Object.entries(labels).map(([id, title]) => ({ id, title: String(title) }))
}

export function EntityViewToggle({
  mode,
  onChange,
  labels,
  showBoard = true,
  showPivot = false,
}: {
  mode: EntitySurfaceMode
  onChange: (mode: EntitySurfaceMode) => void
  labels: NonNullable<EntityTableBoardViewConfig["viewToggleLabels"]>
  showBoard?: boolean
  showPivot?: boolean
}) {
  return (
    <div
      className="flex items-center border border-border rounded-lg p-1"
      role="group"
      aria-label={labels.ariaLabel ?? labels.table}
    >
      <Button
        variant={mode === "table" ? "secondary" : "ghost"}
        size="sm"
        className="h-7 px-2 gap-1.5"
        onClick={() => onChange("table")}
        aria-pressed={mode === "table"}
      >
        <List className="h-4 w-4" />
        {labels.table}
      </Button>
      {showBoard ? (
        <Button
          variant={mode === "board" ? "secondary" : "ghost"}
          size="sm"
          className={cn("h-7 px-2 gap-1.5", mode === "board" && "shadow-sm")}
          onClick={() => onChange("board")}
          aria-pressed={mode === "board"}
        >
          <LayoutGrid className="h-4 w-4" />
          {labels.board}
        </Button>
      ) : null}
      {showPivot ? (
        <Button
          variant={mode === "pivot" ? "secondary" : "ghost"}
          size="sm"
          className={cn("h-7 px-2 gap-1.5", mode === "pivot" && "shadow-sm")}
          onClick={() => onChange("pivot")}
          aria-pressed={mode === "pivot"}
        >
          <BarChart3 className="h-4 w-4" />
          {labels.pivot}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Adds a list / summary toggle in front of a custom list view (accounting invoices and bills).
 * The choice is remembered per list, like the table/board mode of entity views.
 */
export function ListPivotSwitch({
  storageId,
  t,
  rows,
  table,
  pivot,
  children,
}: {
  storageId: string
  t: TFunction
  rows: Record<string, unknown>[]
  table: EntityTableConfig
  pivot: EntityPivotConfig
  children: ReactNode
}) {
  const [mode, setMode] = useState<EntitySurfaceMode>("table")
  const [pivotColumnKey, setPivotColumnKey] = useState("")
  useEffect(() => {
    const stored = readStoredSurfaceState(storageId, ["table", "pivot"])
    if (stored) {
      setMode(stored.mode)
      setPivotColumnKey(stored.columnKey ?? "")
    }
  }, [storageId])
  const change = (next: EntitySurfaceMode) => {
    setMode(next)
    storeSurfaceMode(storageId, next, pivotColumnKey)
  }
  const changePivotColumn = (key: string) => {
    setPivotColumnKey(key)
    storeSurfaceMode(storageId, mode, key)
  }
  return (
    <div className="space-y-3">
      <EntityViewToggle
        mode={mode}
        onChange={change}
        showBoard={false}
        showPivot
        labels={{
          table: t("common.entityView.list", { defaultValue: "List" }),
          board: "",
          pivot: t("common.entityView.pivot", { defaultValue: "Summary" }),
          ariaLabel: t("common.entityView.toggleLabel", { defaultValue: "Switch view" }),
        }}
      />
      {mode === "pivot" ? (
        <EntityPivotView
          rows={rows}
          table={table}
          pivot={pivot}
          initialColumnKey={pivotColumnKey}
          onColumnKeyChange={changePivotColumn}
        />
      ) : (
        children
      )}
    </div>
  )
}

export function EntityView({
  config,
  data = [],
  record = {},
  useCard = true,
  headerAction,
  aiFocusRowKey,
  onRowClick,
  className,
  boardColumns = [],
  onBoardMove,
  boardFilterItem,
  isLoading,
  initialFilters,
  onInitialFilterClear,
}: EntityViewProps) {
  const hybrid =
    config.view.mode === "table-or-board" ? (config.view as EntityTableBoardViewConfig) : null
  const [surfaceMode, setSurfaceMode] = useState<EntitySurfaceMode>(
    hybrid?.defaultView ?? "table",
  )
  // Restore the per-entity choice after mount (keeps SSR markup stable).
  const pivotConfig = hybrid?.pivot
  useEffect(() => {
    if (!hybrid) return
    const stored = readStoredSurfaceState(
      config.id,
      pivotConfig ? ["table", "board", "pivot"] : ["table", "board"],
    )
    if (stored) {
      setSurfaceMode(stored.mode)
      setPivotColumnKey(stored.columnKey ?? "")
    }
  }, [config.id, hybrid !== null, pivotConfig !== undefined]) // eslint-disable-line react-hooks/exhaustive-deps
  const [pivotColumnKey, setPivotColumnKey] = useState("")
  const changeSurfaceMode = (mode: EntitySurfaceMode) => {
    setSurfaceMode(mode)
    storeSurfaceMode(config.id, mode, pivotColumnKey)
  }
  const changePivotColumn = (key: string) => {
    setPivotColumnKey(key)
    storeSurfaceMode(config.id, surfaceMode, key)
  }
  const [boardSearch, setBoardSearch] = useState("")
  // Board filters mirror the table's select filters; they are not persisted.
  const [boardFilters, setBoardFilters] = useState<Record<string, string>>({})

  const plainTableConfig =
    config.view.mode === "table" ? config.view : hybrid ? hybrid.table : null

  const tableConfig = useScopedEntityTableConfig(
    plainTableConfig ?? {
      mode: "table",
      columns: [],
    },
  )

  const content = (() => {
    if (config.view.mode === "detail") {
      return <EntityDetail config={config.view} data={record} />
    }

    if (config.view.mode === "board") {
      if (!boardColumns.length || !onBoardMove) {
        return (
          <p className="text-sm text-muted-foreground">
            Board view requires column definitions and a move handler.
          </p>
        )
      }
      return (
        <EntityBoardView
          config={config.view}
          data={data}
          columns={boardColumns}
          onMove={onBoardMove}
          filterItem={boardFilterItem}
          onCardClick={onRowClick}
        />
      )
    }

    if (hybrid) {
      const boardConfig = { ...hybrid.board, mode: "board" as const }
      const effectiveBoardColumns = boardColumns.length
        ? boardColumns
        : deriveBoardColumns(hybrid.table, hybrid.board.groupKey)
      const searchKeys = tableConfig.searchKeys ?? []
      const boardFilterDefs = (tableConfig.filters ?? []).filter(
        (filter) => filter.type === "select" && filter.options && filter.options.length > 0,
      )
      const boardRowFilter = (row: Record<string, unknown>) =>
        (boardFilterItem ? boardFilterItem(row) : true) &&
        matchesSearch(row, searchKeys, boardSearch.trim()) &&
        boardFilterDefs.every((filter) => {
          const chosen = boardFilters[filter.key]
          return (
            !chosen ||
            chosen === ALL_FILTER_VALUE ||
            rowFilterValue(row, filter.key).toLowerCase() === chosen.toLowerCase()
          )
        })
      return (
        <div className="space-y-3">
          {hybrid.viewToggleLabels ? (
            <EntityViewToggle
              mode={surfaceMode}
              onChange={changeSurfaceMode}
              labels={hybrid.viewToggleLabels}
              showPivot={pivotConfig !== undefined}
            />
          ) : null}

          {surfaceMode === "table" ? (
            <EntityTable
              config={tableConfig}
              data={data}
              aiFocusRowKey={aiFocusRowKey}
              onRowClick={onRowClick}
              isLoading={isLoading}
              initialFilters={initialFilters}
              onInitialFilterClear={onInitialFilterClear}
            />
          ) : surfaceMode === "pivot" && pivotConfig ? (
            <EntityPivotView
              rows={data}
              table={tableConfig}
              pivot={pivotConfig}
              initialColumnKey={pivotColumnKey}
              onColumnKeyChange={changePivotColumn}
            />
          ) : effectiveBoardColumns.length ? (
            <div className="space-y-3">
              {!onBoardMove && (searchKeys.length > 0 || boardFilterDefs.length > 0) ? (
                <div className="flex flex-wrap items-center gap-2">
              {searchKeys.length > 0 ? (
                <Input
                  type="search"
                  value={boardSearch}
                  onChange={(event) => setBoardSearch(event.target.value)}
                  placeholder={hybrid.board.searchPlaceholder ?? tableConfig.searchPlaceholder}
                  aria-label={hybrid.board.searchPlaceholder ?? tableConfig.searchPlaceholder ?? "Search"}
                  className="h-8 max-w-xs"
                  data-testid="entity-board-search"
                />
              ) : null}
              {boardFilterDefs.map((filter) => (
                <select
                  key={filter.key}
                  aria-label={filter.label}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  data-testid={`entity-board-filter-${filter.key}`}
                  value={boardFilters[filter.key] ?? ALL_FILTER_VALUE}
                  onChange={(event) =>
                    setBoardFilters((prev) => ({ ...prev, [filter.key]: event.target.value }))
                  }
                >
                  <option value={ALL_FILTER_VALUE}>{filter.label}</option>
                  {filter.options!.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ))}
                </div>
              ) : null}
              <EntityBoardView
                config={boardConfig}
                data={data}
                columns={effectiveBoardColumns}
                onMove={onBoardMove}
                filterItem={onBoardMove ? boardFilterItem : boardRowFilter}
                onCardClick={onRowClick}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Board view requires column definitions.
            </p>
          )}
        </div>
      )
    }

    if (config.view.mode === "table") {
      return (
        <EntityTable
          config={tableConfig}
          data={data}
          aiFocusRowKey={aiFocusRowKey}
          onRowClick={onRowClick}
          isLoading={isLoading}
          initialFilters={initialFilters}
          onInitialFilterClear={onInitialFilterClear}
        />
      )
    }

    return null
  })()

  if (!useCard) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{config.title}</h2>
            {config.description ? (
              <p className="text-sm text-muted-foreground">{config.description}</p>
            ) : null}
          </div>
          {headerAction ? <div className="flex shrink-0 items-center gap-2">{headerAction}</div> : null}
        </div>
        {content}
      </div>
    )
  }

  return (
    <Card className={cn("bg-card border-border/50", className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle>{config.title}</CardTitle>
          {config.description ? <CardDescription>{config.description}</CardDescription> : null}
        </div>
        {headerAction ? <div className="flex shrink-0 items-center gap-2">{headerAction}</div> : null}
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
