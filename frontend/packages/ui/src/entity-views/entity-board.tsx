"use client"

import { useMemo } from "react"
import { cn } from "../lib/utils"
import type { EntityBoardConfig } from "../lib/entity-view-types"
import type { KanbanColumnDef, KanbanMoveHandler } from "../lib/kanban-board-types"
import { getRowField } from "../lib/entity-row-utils"
import { KanbanBoard } from "../kanban/kanban-board"
import { KanbanColumn } from "../kanban/kanban-column"
import { EntityBoardCard } from "./entity-board-card"

const OTHER_COLUMN_ID = "__other__"

export interface EntityBoardViewProps {
  config: EntityBoardConfig
  data: Record<string, unknown>[]
  columns: KanbanColumnDef[]
  /** Omit for a read-only board: no drag and drop, cards only open the record. */
  onMove?: KanbanMoveHandler
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

  if (!onMove) {
    const grouped = new Map<string, Record<string, unknown>[]>()
    for (const column of columns) grouped.set(column.id, [])
    // Rows whose state has no column must not vanish: they land in an extra "Other" column.
    const other: Record<string, unknown>[] = []
    for (const row of filterItem ? data.filter(filterItem) : data) {
      const bucket = grouped.get(getColumnId(row))
      if (bucket) bucket.push(row)
      else other.push(row)
    }
    const shownColumns =
      other.length > 0
        ? [...columns, { id: OTHER_COLUMN_ID, title: config.otherColumnLabel ?? "Other" }]
        : columns
    if (other.length > 0) grouped.set(OTHER_COLUMN_ID, other)
    return (
      <div className={cn("overflow-x-auto pb-4", className)} data-testid="entity-board-readonly">
        <div className="flex gap-4 min-h-[420px]">
          {shownColumns.map((column) => {
            const rows = grouped.get(column.id) ?? []
            return (
              <KanbanColumn
                key={column.id}
                column={column}
                itemCount={rows.length}
                labels={{ emptyColumn: config.emptyColumnMessage }}
              >
                {rows.map((row) => {
                  const id = getItemId(row)
                  const open = onCardClick ? () => onCardClick(row) : undefined
                  return (
                    <div
                      key={id}
                      role={open ? "button" : undefined}
                      tabIndex={open ? 0 : undefined}
                      data-testid={`entity-board-card-${id}`}
                      onClick={open}
                      onKeyDown={
                        open
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                open()
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        "bg-card border border-border rounded-lg p-3",
                        open && "cursor-pointer hover:border-primary/50 hover:shadow-md transition-all",
                      )}
                    >
                      <EntityBoardCard row={row} card={config.card} />
                    </div>
                  )
                })}
              </KanbanColumn>
            )
          })}
        </div>
      </div>
    )
  }

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
