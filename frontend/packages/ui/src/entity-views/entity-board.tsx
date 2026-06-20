"use client"

import { useMemo } from "react"
import type { EntityBoardConfig } from "../lib/entity-view-types"
import type { KanbanColumnDef, KanbanMoveHandler } from "../lib/kanban-board-types"
import { getRowField } from "../lib/entity-row-utils"
import { KanbanBoard } from "../kanban/kanban-board"
import { EntityBoardCard } from "./entity-board-card"

export interface EntityBoardViewProps {
  config: EntityBoardConfig
  data: Record<string, unknown>[]
  columns: KanbanColumnDef[]
  onMove: KanbanMoveHandler
  filterItem?: (row: Record<string, unknown>) => boolean
  onCardClick?: (row: Record<string, unknown>) => void
  className?: string
}

export function EntityBoardView({
  config,
  data,
  columns,
  onMove,
  filterItem,
  onCardClick,
  className,
}: EntityBoardViewProps) {
  const rowKey = config.rowKey ?? "id"

  const getItemId = useMemo(
    () => (row: Record<string, unknown>) => String(getRowField(row, rowKey) ?? ""),
    [rowKey],
  )

  const getColumnId = useMemo(
    () => (row: Record<string, unknown>) => String(getRowField(row, config.groupKey) ?? ""),
    [config.groupKey],
  )

  return (
    <KanbanBoard
      columns={columns}
      items={data}
      getItemId={getItemId}
      getColumnId={getColumnId}
      filterItem={filterItem}
      onMove={onMove}
      onItemClick={onCardClick}
      labels={{ emptyColumn: config.emptyColumnMessage }}
      className={className}
      renderCard={(row, ctx) => (
        <EntityBoardCard row={row} card={config.card} />
      )}
    />
  )
}
