"use client"

import { useMemo, useState } from "react"
import { LayoutGrid, List } from "lucide-react"
import { cn } from "../lib/utils"
import type {
  EntityDetailConfig,
  EntityPermissioned,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Button } from "../components/button"

interface EntityViewProps {
  config: EntityViewConfig
  data?: Record<string, unknown>[]
  record?: Record<string, unknown>
  useCard?: boolean
  aiFocusRowKey?: string
  onRowClick?: (row: Record<string, unknown>) => void
  className?: string
  boardColumns?: KanbanColumnDef[]
  onBoardMove?: KanbanMoveHandler
  boardFilterItem?: (row: Record<string, unknown>) => boolean
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
      columns,
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

type EntitySurfaceMode = "table" | "board"

function EntityViewToggle({
  mode,
  onChange,
  labels,
}: {
  mode: EntitySurfaceMode
  onChange: (mode: EntitySurfaceMode) => void
  labels: NonNullable<EntityTableBoardViewConfig["viewToggleLabels"]>
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
    </div>
  )
}

export function EntityView({
  config,
  data = [],
  record = {},
  useCard = true,
  aiFocusRowKey,
  onRowClick,
  className,
  boardColumns = [],
  onBoardMove,
  boardFilterItem,
}: EntityViewProps) {
  const hybrid =
    config.view.mode === "table-or-board" ? (config.view as EntityTableBoardViewConfig) : null
  const [surfaceMode, setSurfaceMode] = useState<EntitySurfaceMode>(
    hybrid?.defaultView ?? "table",
  )

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
      return (
        <div className="space-y-3">
          {hybrid.viewToggleLabels ? (
            <EntityViewToggle
              mode={surfaceMode}
              onChange={setSurfaceMode}
              labels={hybrid.viewToggleLabels}
            />
          ) : null}

          {surfaceMode === "table" ? (
            <EntityTable
              config={tableConfig}
              data={data}
              aiFocusRowKey={aiFocusRowKey}
              onRowClick={onRowClick}
            />
          ) : boardColumns.length && onBoardMove ? (
            <EntityBoardView
              config={boardConfig}
              data={data}
              columns={boardColumns}
              onMove={onBoardMove}
              filterItem={boardFilterItem}
              onCardClick={onRowClick}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Board view requires column definitions and a move handler.
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
        />
      )
    }

    return null
  })()

  if (!useCard) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-foreground">{config.title}</h2>
          {config.description ? (
            <p className="text-sm text-muted-foreground">{config.description}</p>
          ) : null}
        </div>
        {content}
      </div>
    )
  }

  return (
    <Card className={cn("bg-card border-border/50", className)}>
      <CardHeader>
        <CardTitle>{config.title}</CardTitle>
        {config.description ? <CardDescription>{config.description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
