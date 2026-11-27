"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, ArrowUpRight, HelpCircle, Info, Lock } from "lucide-react"

import { cn } from "../lib/utils"
import { Kbd, KbdGroup } from "./kbd"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip"

export interface MicroTooltipProps {
  /** Concise tooltip copy. */
  content: React.ReactNode
  /** Optional keyboard shortcut keys rendered as <Kbd> pills. */
  shortcut?: string | string[]
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  delayDuration?: number
  className?: string
  children: React.ReactNode
}

/**
 * Crisp, fast-delay tooltip with optional keyboard shortcut badge.
 * Prefer this over raw native `title=` attributes.
 */
export function MicroTooltip({
  content,
  shortcut,
  side = "top",
  align = "center",
  delayDuration = 250,
  className,
  children,
}: MicroTooltipProps) {
  const keys = shortcut ? (Array.isArray(shortcut) ? shortcut : [shortcut]) : []

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          className={cn(
            "flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium",
            className
          )}
        >
          <span>{content}</span>
          {keys.length > 0 && (
            <KbdGroup className="gap-0.5">
              {keys.map((key) => (
                <Kbd key={key} className="h-4 min-w-4 px-1 text-[10px]">
                  {key}
                </Kbd>
              ))}
            </KbdGroup>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export interface ExplainDetailItem {
  label: string
  value: string
}

export interface ExplainPopoverProps {
  /** Short, clear title of what the user is looking at. */
  title: string
  /** Plain-language explanation of the concept, rule, or column. */
  description: React.ReactNode
  /** Optional formula or rule expression displayed in a monospace callout. */
  formula?: string
  /** Optional structured metadata rows (e.g. Scope, Basis, Owner). */
  details?: ExplainDetailItem[]
  /** Optional deep-link to a workspace guide or related view. */
  learnMoreHref?: string
  learnMoreLabel?: string
  /** Icon variant for the default trigger button. */
  icon?: "info" | "help"
  /** Accessible label for the default trigger button. */
  triggerLabel?: string
  /** Custom trigger element; defaults to a subtle icon button. */
  trigger?: React.ReactElement
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  className?: string
}

/**
 * Structured "what am I looking at?" explanation popover.
 * Keeps dense operational UI clean while keeping authoritative rules one click away.
 */
export function ExplainPopover({
  title,
  description,
  formula,
  details,
  learnMoreHref,
  learnMoreLabel = "Learn more",
  icon = "help",
  triggerLabel,
  trigger,
  side = "bottom",
  align = "start",
  className,
}: ExplainPopoverProps) {
  const Icon = icon === "info" ? Info : HelpCircle
  const defaultTrigger = (
    <button
      type="button"
      aria-label={triggerLabel ?? `Explain ${title}`}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  )

  return (
    <Popover>
      <PopoverTrigger render={trigger ?? defaultTrigger} />
      <PopoverContent side={side} align={align} className="w-80 gap-3 p-3.5">
        <PopoverHeader className="gap-1">
          <PopoverTitle className="text-xs font-semibold tracking-tight text-foreground">
            {title}
          </PopoverTitle>
          <PopoverDescription className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </PopoverDescription>
        </PopoverHeader>

        {formula && (
          <div className="rounded-md border border-border/60 bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-foreground">
            {formula}
          </div>
        )}

        {details && details.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-xs">
            {details.map((item) => (
              <React.Fragment key={item.label}>
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="text-right font-medium text-foreground">{item.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}

        {learnMoreHref && (
          <div className="border-t border-border/60 pt-2">
            <Link
              href={learnMoreHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {learnMoreLabel}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export interface MetricInfoPopoverProps {
  /** Metric or KPI name. */
  label: string
  /** Plain-language explanation of what the figure measures. */
  definition: string
  /** Optional calculation formula. */
  formula?: string
  /** Accounting/reporting basis (e.g. "Posted entries only", "Accrual"). */
  basis?: string
  /** Data scope (e.g. "Selected company & period"). */
  scope?: string
  /** Data freshness signal (e.g. "Live from ledger"). */
  freshness?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  className?: string
}

/**
 * Specialized contextual explanation popover for KPIs, stat cards, and financial figures.
 */
export function MetricInfoPopover({
  label,
  definition,
  formula,
  basis,
  scope,
  freshness,
  side = "bottom",
  align = "end",
  className,
}: MetricInfoPopoverProps) {
  const details: ExplainDetailItem[] = []
  if (basis) details.push({ label: "Basis", value: basis })
  if (scope) details.push({ label: "Scope", value: scope })
  if (freshness) details.push({ label: "Freshness", value: freshness })

  return (
    <ExplainPopover
      title={label}
      description={definition}
      formula={formula}
      details={details.length > 0 ? details : undefined}
      icon="info"
      triggerLabel={`Metric details for ${label}`}
      side={side}
      align={align}
      className={className}
    />
  )
}

export interface BlockerPopoverProps {
  /** Why the action is currently unavailable or blocked. */
  reason: string
  /** Optional title; defaults to "Action unavailable". */
  title?: string
  /** Optional guidance on how to resolve the blocker. */
  remediation?: string
  /** Optional CTA label to jump to or trigger remediation. */
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
  /** Optional tone; defaults to "warning". */
  tone?: "warning" | "locked"
  /** Optional wrapped element (e.g. a disabled button). If omitted, renders a compact trigger icon. */
  children?: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  className?: string
}

/**
 * Explains why a workflow action or control is disabled/blocked, with an optional remediation path.
 */
export function BlockerPopover({
  reason,
  title = "Action unavailable",
  remediation,
  actionLabel,
  onAction,
  actionHref,
  tone = "locked",
  children,
  side = "top",
  align = "center",
  className,
}: BlockerPopoverProps) {
  const Icon = tone === "warning" ? AlertCircle : Lock
  const triggerEl = children ? (
    <span
      tabIndex={0}
      role="button"
      aria-label={`${title}: ${reason}`}
      className={cn(
        "inline-flex cursor-help items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
    >
      {children}
    </span>
  ) : (
    <button
      type="button"
      aria-label={`${title}: ${reason}`}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  )

  return (
    <Popover>
      <PopoverTrigger render={triggerEl} />
      <PopoverContent side={side} align={align} className="w-76 gap-2.5 p-3.5">
        <div className="flex items-start gap-2">
          <Icon
            className={cn(
              "mt-0.5 size-4 shrink-0",
              tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            )}
            aria-hidden="true"
          />
          <PopoverHeader className="gap-1">
            <PopoverTitle className="text-xs font-semibold text-foreground">
              {title}
            </PopoverTitle>
            <PopoverDescription className="text-xs leading-relaxed text-muted-foreground">
              {reason}
            </PopoverDescription>
          </PopoverHeader>
        </div>

        {remediation && (
          <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs leading-relaxed text-foreground">
            {remediation}
          </p>
        )}

        {actionLabel && (actionHref || onAction) && (
          <div className="border-t border-border/60 pt-2">
            {actionHref ? (
              <Link
                href={actionHref}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {actionLabel}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={onAction}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {actionLabel}
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
