"use client"

import { useDroppable } from "@dnd-kit/core"
import { cn } from "../lib/utils"
import { Button } from "../components/button"
import { Plus } from "lucide-react"
import type { KanbanBoardLabels, KanbanColumnDef } from "../lib/kanban-board-types"

interface KanbanColumnProps {
  column: KanbanColumnDef
  itemCount: number
  onAddItem?: () => void
  labels?: KanbanBoardLabels
  minHeight?: string
  children: React.ReactNode
}

export function KanbanColumn({
  column,
  itemCount,
  onAddItem,
  labels,
  minHeight = "min-h-[200px]",
  children,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { column },
  })

  const atWipLimit = column.limit != null && itemCount >= column.limit

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          {column.colorClass ? (
            <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", column.colorClass)} />
          ) : null}
          <h3 className="text-sm font-semibold text-foreground truncate">{column.title}</h3>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
            {itemCount}
          </span>
        </div>
        {onAddItem ? (
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onAddItem}>
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 p-2 rounded-lg bg-muted/30 border-2 border-dashed border-transparent transition-colors space-y-2",
          minHeight,
          isOver && "border-primary/50 bg-primary/5",
        )}
      >
        {children}

        {itemCount === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground text-center px-2">
            {labels?.emptyColumn ?? "Drop items here"}
          </div>
        ) : null}
      </div>

      {atWipLimit ? (
        <div className="mt-2 px-2 py-1 text-xs text-warning bg-warning/10 rounded">
          {labels?.wipLimitReached?.(column.limit!) ??
            `WIP limit reached (${column.limit})`}
        </div>
      ) : null}
    </div>
  )
}
