import type { ReactNode } from "react"

export interface KanbanColumnDef {
  id: string
  title: string
  /** Tailwind background class for the column dot, e.g. `bg-info` */
  colorClass?: string
  limit?: number
}

export interface KanbanBoardLabels {
  emptyColumn?: string
  wipLimitReached?: (limit: number) => string
}

export interface KanbanMoveEvent {
  itemId: string
  fromColumnId: string
  toColumnId: string
  item: Record<string, unknown>
}

export type KanbanMoveHandler = (event: KanbanMoveEvent) => void | Promise<void>

export interface KanbanBoardProps {
  columns: KanbanColumnDef[]
  items: Record<string, unknown>[]
  getItemId: (item: Record<string, unknown>) => string
  getColumnId: (item: Record<string, unknown>) => string
  filterItem?: (item: Record<string, unknown>) => boolean
  renderCard: (
    item: Record<string, unknown>,
    ctx: { isDragOverlay?: boolean; onClick?: () => void },
  ) => ReactNode
  onMove: KanbanMoveHandler
  onItemClick?: (item: Record<string, unknown>) => void
  labels?: KanbanBoardLabels
  className?: string
  minColumnHeight?: string
}

export const DEFAULT_KANBAN_COLUMN_COLORS = [
  "bg-info",
  "bg-category-3",
  "bg-warning",
  "bg-success",
  "bg-destructive",
  "bg-primary",
] as const
