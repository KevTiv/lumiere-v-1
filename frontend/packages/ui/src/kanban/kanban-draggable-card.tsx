"use client"

import { useId } from "react"
import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "../lib/utils"

interface KanbanDraggableCardProps {
  id: string
  data?: { [key: string]: unknown }
  onClick?: () => void
  isDragOverlay?: boolean
  disabled?: boolean
  disabledReason?: string
  isPending?: boolean
  pendingLabel?: string
  children: React.ReactNode
  className?: string
}

export function KanbanDraggableCard({
  id,
  data,
  onClick,
  isDragOverlay,
  disabled = false,
  disabledReason,
  isPending = false,
  pendingLabel = "Updating…",
  children,
  className,
}: KanbanDraggableCardProps) {
  const reasonId = useId()
  const dragDisabled =
    disabled || isPending || Boolean(disabledReason) || Boolean(isDragOverlay)
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: isDragOverlay ? `kanban-overlay-${reasonId}` : id,
      data,
      disabled: dragDisabled,
    })

  const isNestedControl = (target: EventTarget | null, card: HTMLElement) => {
    if (!(target instanceof Element)) return false
    const control = target.closest(
      'button, a, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"], [tabindex], [data-kanban-no-drag]',
    )
    return control != null && control !== card && card.contains(control)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...(!dragDisabled ? attributes : {})}
      {...(!dragDisabled ? listeners : {})}
      role={
        isDragOverlay
          ? undefined
          : onClick || !dragDisabled
            ? "button"
            : undefined
      }
      tabIndex={
        isDragOverlay ? undefined : onClick || !dragDisabled ? 0 : undefined
      }
      aria-hidden={isDragOverlay || undefined}
      aria-busy={isPending || undefined}
      aria-describedby={
        [
          !dragDisabled ? attributes["aria-describedby"] : undefined,
          disabledReason ? reasonId : undefined,
        ]
          .filter(Boolean)
          .join(" ") || undefined
      }
      onPointerDown={(event) => {
        if (
          !dragDisabled &&
          !isNestedControl(event.target, event.currentTarget)
        ) {
          listeners?.onPointerDown?.(event)
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (
          onClick &&
          !isDragging &&
          (event.key === "Enter" || (dragDisabled && event.key === " "))
        ) {
          event.preventDefault()
          onClick()
          return
        }
        if (!dragDisabled) listeners?.onKeyDown?.(event)
      }}
      onClick={(event) => {
        if (!isDragging && !isNestedControl(event.target, event.currentTarget))
          onClick?.()
      }}
      data-draggable={!dragDisabled}
      data-testid={isDragOverlay ? undefined : `kanban-card-${id}`}
      className={cn(
        "bg-card border border-border rounded-xl p-3 shadow-xs transition-all",
        !dragDisabled &&
          "cursor-grab active:cursor-grabbing select-none touch-none",
        (onClick || !dragDisabled) && "hover:border-primary/50 hover:shadow-md",
        dragDisabled && onClick && "cursor-pointer",
        isPending && "cursor-wait",
        isDragging && "opacity-50 shadow-lg",
        isDragOverlay && "shadow-xl rotate-2 scale-105",
        className,
      )}
    >
      {children}
      {isPending ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {pendingLabel}
        </p>
      ) : null}
      {disabledReason ? (
        <p id={reasonId} className="mt-2 text-xs text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </div>
  )
}
