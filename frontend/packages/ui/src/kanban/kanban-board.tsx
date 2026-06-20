"use client"

import { useMemo, useState } from "react"
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { cn } from "../lib/utils"
import type { KanbanBoardProps } from "../lib/kanban-board-types"
import { KanbanColumn } from "./kanban-column"
import { KanbanDraggableCard } from "./kanban-draggable-card"

export function KanbanBoard({
  columns,
  items,
  getItemId,
  getColumnId,
  filterItem,
  renderCard,
  onMove,
  labels,
  className,
  minColumnHeight,
  onItemClick,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const visibleItems = useMemo(
    () => (filterItem ? items.filter(filterItem) : items),
    [filterItem, items],
  )

  const itemsByColumn = useMemo(() => {
    const grouped = new Map<string, Record<string, unknown>[]>()
    for (const column of columns) grouped.set(column.id, [])
    for (const item of visibleItems) {
      const columnId = getColumnId(item)
      const bucket = grouped.get(columnId)
      if (bucket) bucket.push(item)
    }
    return grouped
  }, [columns, getColumnId, visibleItems])

  const activeItem = activeId
    ? visibleItems.find((item) => getItemId(item) === activeId)
    : null

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const targetColumnId = String(over.id)
    if (!columns.some((column) => column.id === targetColumnId)) return

    const item = visibleItems.find((row) => getItemId(row) === String(active.id))
    if (!item) return

    const fromColumnId = getColumnId(item)
    if (fromColumnId === targetColumnId) return

    void onMove({
      itemId: getItemId(item),
      fromColumnId,
      toColumnId: targetColumnId,
      item,
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={cn("overflow-x-auto pb-4", className)}>
        <div className="flex gap-4 min-h-[420px]">
          {columns.map((column) => {
            const columnItems = itemsByColumn.get(column.id) ?? []
            return (
              <KanbanColumn
                key={column.id}
                column={column}
                itemCount={columnItems.length}
                labels={labels}
                minHeight={minColumnHeight}
              >
                {columnItems.map((item) => {
                  const id = getItemId(item)
                  const handleClick = onItemClick ? () => onItemClick(item) : undefined
                  return (
                    <KanbanDraggableCard key={id} id={id} data={{ item }} onClick={handleClick}>
                      {renderCard(item, { onClick: handleClick })}
                    </KanbanDraggableCard>
                  )
                })}
              </KanbanColumn>
            )
          })}
        </div>
      </div>

      <DragOverlay>
        {activeItem ? (
          <KanbanDraggableCard
            id={getItemId(activeItem)}
            isDragOverlay
            data={{ item: activeItem }}
          >
            {renderCard(activeItem, { isDragOverlay: true })}
          </KanbanDraggableCard>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
