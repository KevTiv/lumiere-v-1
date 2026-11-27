"use client"

import * as React from "react"
import { Building2, Calendar, CheckCircle2, Clock, Coins, Scale, AlertTriangle } from "lucide-react"

import { cn } from "../lib/utils"
import { ExplainPopover } from "../components/contextual-help"

export type ReportReadinessTone = "ready" | "partial" | "blocked"

export interface ReportContextBarProps {
  /** Operating company or consolidation scope. */
  company?: string | null
  /** Reporting date range label (e.g. "Jan 1 – Dec 31, 2026" or "As of Nov 27, 2026"). */
  period?: string | null
  /** Accounting basis (e.g. "Posted entries only", "Accrual basis"). */
  basis?: string | null
  /** Optional explanation shown in a popover next to the accounting basis. */
  basisExplanation?: string
  /** Currency code (e.g. "EUR", "USD"). */
  currency?: string | null
  /** Freshness label (e.g. "Live from ledger" or timestamp). */
  freshness?: string | null
  /** Readiness state of the underlying report data. */
  readiness?: {
    tone: ReportReadinessTone
    label: string
    detail?: string
  }
  /** Optional right-aligned controls (export, compare period, etc.). */
  actions?: React.ReactNode
  className?: string
  testId?: string
}

/**
 * Compact analytical trust strip placed above financial statements and reports.
 * Makes scope, period, currency, accounting basis, and readiness immediately parseable.
 */
export function ReportContextBar({
  company,
  period,
  basis,
  basisExplanation,
  currency,
  freshness,
  readiness,
  actions,
  className,
  testId = "report-context-bar",
}: ReportContextBarProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted-foreground">
        {company ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{company}</span>
          </span>
        ) : null}

        {period ? (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{period}</span>
          </span>
        ) : null}

        {currency ? (
          <span className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
            <Coins className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{currency}</span>
          </span>
        ) : null}

        {basis ? (
          <span className="inline-flex items-center gap-1.5">
            <Scale className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{basis}</span>
            {basisExplanation ? (
              <ExplainPopover
                title={basis}
                description={basisExplanation}
                icon="info"
              />
            ) : null}
          </span>
        ) : null}

        {freshness ? (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{freshness}</span>
          </span>
        ) : null}

        {readiness ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              readiness.tone === "ready" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              readiness.tone === "partial" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
              readiness.tone === "blocked" && "bg-destructive/10 text-destructive",
            )}
          >
            {readiness.tone === "ready" ? (
              <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span>{readiness.label}</span>
            {readiness.detail ? (
              <ExplainPopover
                title={readiness.label}
                description={readiness.detail}
                icon="info"
              />
            ) : null}
          </span>
        ) : null}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
