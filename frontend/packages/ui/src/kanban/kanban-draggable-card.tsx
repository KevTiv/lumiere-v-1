"use client"

import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "../lib/utils"

interface KanbanDraggableCardProps {
  id: string
  data?: Record<string, unknown>
  onClick?: () => void
  isDragOverlay?: boolean
  children: React.ReactNode
  className?: string
}

export function KanbanDraggableCard({
  id,
  data,
  onClick,
  isDragOverlay,
  children,
  className,
}: KanbanDraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing",
        "hover:border-primary/50 hover:shadow-md transition-all",
        "select-none touch-none",
        isDragging && "opacity-50 shadow-lg",
        isDragOverlay && "shadow-xl rotate-2 scale-105",
        className,
      )}
    >
      {children}
    </div>
  )
}
