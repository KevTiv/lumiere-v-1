import type { ReactNode } from "react"
import type { EntityRow } from "./entity-view-types"

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
  pendingMove?: string
  moveFailed?: string
}

export interface KanbanMoveEvent<T extends object = EntityRow> {
  itemId: string
  fromColumnId: string
  toColumnId: string
  item: T
}

export type KanbanMoveHandler<T extends object = EntityRow> = (
  event: KanbanMoveEvent<T>,
) => void | Promise<void>

export interface KanbanBoardProps<T extends object = EntityRow> {
  columns: KanbanColumnDef[]
  items: T[]
  getItemId: (item: T) => string
  getColumnId: (item: T) => string
  filterItem?: (item: T) => boolean
  renderCard: (
    item: T,
    ctx: {
      isDragOverlay?: boolean
      onClick?: () => void
      isPending?: boolean
      moveDisabledReason?: string
    },
  ) => ReactNode
  /** Omit for a read-only board. Cards can still open their records. */
  onMove?: KanbanMoveHandler<T>
  /** Presentation affordance only; the server must authorize the actual transition. */
  canMove?: (item: T, toColumnId: string) => boolean
  isItemDraggable?: (item: T) => boolean
  /** Keeps a card locked while the caller is awaiting canonical readback. */
  isItemPending?: (item: T) => boolean
  /** A nonempty reason disables moves and is shown on the card. */
  moveDisabledReason?: (item: T) => string | undefined
  onMoveError?: (
    error: unknown,
    event: KanbanMoveEvent<T>,
  ) => void | Promise<void>
  onItemClick?: (item: T) => void
  labels?: KanbanBoardLabels
  className?: string
  minColumnHeight?: string
  /** Adds an "add" button to each column header. */
  onAddItem?: (columnId: string) => void
}

export const DEFAULT_KANBAN_COLUMN_COLORS = [
  "bg-info",
  "bg-category-3",
  "bg-warning",
  "bg-success",
  "bg-destructive",
  "bg-primary",
] as const
