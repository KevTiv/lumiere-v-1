"use client"

import type { ComponentType, ReactNode } from "react"
import { TrendingDown, TrendingUp } from "lucide-react"
import { cn } from "../lib/utils"
import { MetricInfoPopover, type MetricInfoPopoverProps } from "./contextual-help"

export type StatCardTone = "default" | "success" | "warning" | "destructive" | "info"

const toneIconClass: Record<StatCardTone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
}

export type StatCardHelp =
  | string
  | Pick<MetricInfoPopoverProps, "definition" | "formula" | "basis" | "scope" | "freshness">

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  icon?: ComponentType<{ className?: string }>
  /** Colours the icon only; the value stays neutral so numbers read calmly. */
  tone?: StatCardTone
  /** Percent change vs the previous period, shown as a ± delta pill under the value. */
  change?: number
  /** Comparison the delta refers to. Defaults to "vs last period". */
  changeLabel?: string
  /** Set when a rise is bad (costs, overdue): the delta's colours flip. */
  invertChange?: boolean
  /** Small line under the value (unit, context). Shown after the delta. */
  footer?: ReactNode
  /** Contextual explanation popover describing the metric formula, basis, and scope. */
  help?: StatCardHelp
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
  change,
  changeLabel = "vs last period",
  invertChange = false,
  footer,
  help,
  onClick,
  className,
  testId,
}: StatCardProps) {
  const clickable = typeof onClick === "function"
  const helpConfig = typeof help === "string" ? { definition: help } : help
  const helpLabel = typeof label === "string" ? label : "Metric"
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
        "min-w-0 max-w-full [overflow-wrap:anywhere] rounded-xl border border-border bg-card p-4 shadow-xs",
        clickable && "cursor-pointer transition-colors hover:bg-muted/40",
        className,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 pt-0.5">
          <span title={typeof label === "string" ? label : undefined} className="min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</span>
          {helpConfig ? (
            <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <MetricInfoPopover label={helpLabel} {...helpConfig} />
            </span>
          ) : null}
        </div>
        {Icon ? (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneIconClass[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      {change !== undefined && Number.isFinite(change) ? (
        <StatDelta change={change} label={changeLabel} invert={invertChange} />
      ) : null}
      {footer ? <div className="mt-1 min-w-0">{footer}</div> : null}
    </div>
  )
}

/** "+12.4% vs last month" pill; green when the move is good, red when bad. */
export function StatDelta({ change, label, invert = false }: { change: number; label?: string; invert?: boolean }) {
  const good = invert ? change < 0 : change > 0
  const bad = invert ? change > 0 : change < 0
  const Icon = change < 0 ? TrendingDown : TrendingUp
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 font-medium tabular-nums",
          good && "bg-success/10 text-success",
          bad && "bg-destructive/10 text-destructive",
          !good && !bad && "bg-muted text-muted-foreground",
        )}
      >
        {change !== 0 ? <Icon className="h-3 w-3 shrink-0" /> : null}
        {change > 0 ? "+" : ""}
        {change.toFixed(1)}%
      </span>
      {label ? <span className="min-w-0 text-muted-foreground">{label}</span> : null}
    </div>
  )
}

/** Cards respond to their panel's width, including nested dashboards and enlarged text. */
export function StatCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4", className)}>{children}</div>
}
