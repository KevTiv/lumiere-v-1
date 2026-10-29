"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useMemo, useRef, useState } from "react"
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
import type { EntityRow } from "../lib/entity-view-types"
import type {
  KanbanBoardProps,
  KanbanMoveEvent,
} from "../lib/kanban-board-types"
import { KanbanColumn } from "./kanban-column"
import { KanbanDraggableCard } from "./kanban-draggable-card"

export function KanbanBoard<T extends object = EntityRow>({
  columns,
  items,
  getItemId,
  getColumnId,
  filterItem,
  renderCard,
  onMove,
  canMove,
  isItemDraggable,
  isItemPending,
  moveDisabledReason,
  onMoveError,
  labels,
  className,
  minColumnHeight,
  onItemClick,
  onAddItem,
}: KanbanBoardProps<T>) {
  useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeDrag = useRef<{ itemId: string; fromColumnId: string } | null>(
    null,
  )
  // The ref closes the gap before React renders the disabled card after a drop.
  const pendingMoveIds = useRef(new Set<string>())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [moveError, setMoveError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const visibleItems = useMemo(
    () => (filterItem ? items.filter(filterItem) : items),
    [filterItem, items],
  )

  const itemsByColumn = useMemo(() => {
    const grouped = new Map<string, T[]>()
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

  const itemIsPending = (item: T) =>
    pendingIds.has(getItemId(item)) || Boolean(isItemPending?.(item))
  const itemCanDrag = (item: T) =>
    Boolean(onMove) &&
    !itemIsPending(item) &&
    !moveDisabledReason?.(item) &&
    (isItemDraggable?.(item) ?? true) &&
    columns.some(
      (column) =>
        column.id !== getColumnId(item) && (canMove?.(item, column.id) ?? true),
    )

  const clearDrag = () => {
    activeDrag.current = null
    setActiveId(null)
  }

  const handleDragStart = (event: DragStartEvent) => {
    const item = visibleItems.find(
      (row) => getItemId(row) === String(event.active.id),
    )
    if (
      !item ||
      pendingMoveIds.current.has(getItemId(item)) ||
      !itemCanDrag(item)
    ) {
      clearDrag()
      return
    }
    activeDrag.current = {
      itemId: getItemId(item),
      fromColumnId: getColumnId(item),
    }
    setActiveId(getItemId(item))
  }

  const performMove = async (move: KanbanMoveEvent<T>) => {
    try {
      await onMove?.(move)
    } catch (error) {
      const failedMessage =
        labels?.moveFailed ?? i18n.t("ui.kanban.kanbanBoard.couldNotMoveItemTryAgain")
      if (onMoveError) {
        try {
          await onMoveError(error, move)
        } catch {
          setMoveError(failedMessage)
        }
      } else {
        setMoveError(failedMessage)
      }
    } finally {
      pendingMoveIds.current.delete(move.itemId)
      setPendingIds(new Set(pendingMoveIds.current))
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    const started = activeDrag.current
    clearDrag()
    if (!over || !started || started.itemId !== String(active.id)) return

    const targetColumnId = String(over.id)
    if (!columns.some((column) => column.id === targetColumnId)) return

    const item = visibleItems.find(
      (row) => getItemId(row) === String(active.id),
    )
    if (
      !item ||
      pendingMoveIds.current.has(getItemId(item)) ||
      !itemCanDrag(item) ||
      !(canMove?.(item, targetColumnId) ?? true)
    )
      return

    const fromColumnId = getColumnId(item)
    if (
      fromColumnId === targetColumnId ||
      fromColumnId !== started.fromColumnId
    )
      return

    const itemId = getItemId(item)
    pendingMoveIds.current.add(itemId)
    setPendingIds(new Set(pendingMoveIds.current))
    setMoveError(null)
    void performMove({
      itemId,
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
      onDragCancel={clearDrag}
    >
      <div className={cn("overflow-x-auto pb-4", className)}>
        {moveError ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {moveError}
          </p>
        ) : null}
        <div className="flex gap-4 min-h-[420px]" data-testid="kanban-board">
          {columns.map((column) => {
            const columnItems = itemsByColumn.get(column.id) ?? []
            return (
              <KanbanColumn
                key={column.id}
                column={column}
                itemCount={columnItems.length}
                labels={labels}
                minHeight={minColumnHeight}
                disabled={
                  !onMove ||
                  Boolean(
                    activeItem &&
                    (!itemCanDrag(activeItem) ||
                      !(canMove?.(activeItem, column.id) ?? true)),
                  )
                }
                onAddItem={onAddItem ? () => onAddItem(column.id) : undefined}
              >
                {columnItems.map((item) => {
                  const id = getItemId(item)
                  const handleClick = onItemClick
                    ? () => onItemClick(item)
                    : undefined
                  const isPending = itemIsPending(item)
                  const disabledReason = moveDisabledReason?.(item)
                  return (
                    <KanbanDraggableCard
                      key={id}
                      id={id}
                      data={{ item }}
                      onClick={handleClick}
                      disabled={!itemCanDrag(item)}
                      disabledReason={disabledReason}
                      isPending={isPending}
                      pendingLabel={labels?.pendingMove}
                    >
                      {renderCard(item, {
                        onClick: handleClick,
                        isPending,
                        moveDisabledReason: disabledReason,
                      })}
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
