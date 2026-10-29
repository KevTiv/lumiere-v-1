"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useDroppable } from "@dnd-kit/core"
import { cn } from "../lib/utils"
import { Button } from "../components/button"
import { Plus } from "lucide-react"
import type {
  KanbanBoardLabels,
  KanbanColumnDef,
} from "../lib/kanban-board-types"

interface KanbanColumnProps {
  column: KanbanColumnDef
  itemCount: number
  onAddItem?: () => void
  labels?: KanbanBoardLabels
  minHeight?: string
  disabled?: boolean
  children: React.ReactNode
}

export function KanbanColumn({
  column,
  itemCount,
  onAddItem,
  labels,
  minHeight = "min-h-[200px]",
  disabled = false,
  children,
}: KanbanColumnProps) {
  useTranslation()
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { column },
    disabled,
  })

  const atWipLimit = column.limit != null && itemCount >= column.limit

  return (
    <div
      className="flex w-[17rem] shrink-0 flex-col sm:w-72"
      data-testid={`kanban-column-${column.id}`}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          {column.colorClass ? (
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full shrink-0",
                column.colorClass,
              )}
            />
          ) : null}
          <h3 className="text-sm font-semibold text-foreground truncate">
            {column.title}
          </h3>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {itemCount}
          </span>
        </div>
        {onAddItem ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onAddItem}
            aria-label={i18n.t("ui.kanban.kanbanColumn.addToValue", { value1: column.title })}
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-2 rounded-xl border-2 border-dashed border-transparent bg-muted/40 p-2 transition-colors",
          minHeight,
          isOver && !disabled && "border-primary/50 bg-primary/5",
        )}
      >
        {children}

        {itemCount === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground text-center px-2">
            {labels?.emptyColumn ?? i18n.t("ui.kanban.kanbanColumn.dropItemsHere")}
          </div>
        ) : null}
      </div>

      {atWipLimit ? (
        <div className="mt-2 px-2 py-1 text-xs text-warning bg-warning/10 rounded">
          {labels?.wipLimitReached?.(column.limit!) ??
            i18n.t("ui.kanban.kanbanColumn.wipLimitReachedValue", { value1: column.limit })}
        </div>
      ) : null}
    </div>
  )
}
