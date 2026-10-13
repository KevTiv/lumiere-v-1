"use client"

import type { ComponentType, ReactNode } from "react"
import { cn } from "../lib/utils"

export type StatCardTone = "default" | "success" | "warning" | "destructive" | "info"

const toneIconClass: Record<StatCardTone, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
}

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  icon?: ComponentType<{ className?: string }>
  /** Colours the icon only; the value stays neutral so numbers read calmly. */
  tone?: StatCardTone
  /** Small line under the value (trend badge, unit, context). */
  footer?: ReactNode
  onClick?: () => void
  className?: string
  testId?: string
}

/** The one summary-figure tile used across dashboards and list headers. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  footer,
  onClick,
  className,
  testId,
}: StatCardProps) {
  const clickable = typeof onClick === "function"
  return (
    <div
      data-testid={testId}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-xs",
        clickable && "cursor-pointer transition-colors hover:bg-muted/40",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className={cn("h-4 w-4 shrink-0", toneIconClass[tone])} /> : null}
      </div>
      <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      {footer ? <div className="mt-1">{footer}</div> : null}
    </div>
  )
}

/** Responsive grid for a row of stat cards (2 → 4 columns, no orphan stretching). */
export function StatCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-4", className)}>{children}</div>
}
