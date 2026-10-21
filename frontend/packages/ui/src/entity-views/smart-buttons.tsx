"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "../lib/utils"

export interface SmartButton {
  id: string
  label: string
  /** Number of related records. A button with `hideWhenZero` and no records is left out. */
  count: number
  icon?: ReactNode
  /** Where the button goes; give `onClick` instead for something that stays on the page. */
  href?: string
  onClick?: () => void
  /** Hide rather than show "0" for relations that most records never have. */
  hideWhenZero?: boolean
}

export interface SmartButtonsProps {
  buttons: ReadonlyArray<SmartButton>
  /** Prefix for test ids: `{prefix}-{id}`. */
  testIdPrefix: string
  className?: string
}

const buttonClass =
  "flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"

/**
 * A row of related-record buttons for a record's header ("2 Invoices", "1 Delivery"), each taking
 * you to those records. Presentation only: callers count and link.
 */
export function SmartButtons({ buttons, testIdPrefix, className }: SmartButtonsProps) {
  const shown = buttons.filter((button) => !(button.hideWhenZero && button.count === 0))
  if (shown.length === 0) return null

  return (
    <div className={cn("flex flex-wrap gap-2", className)} data-testid={`${testIdPrefix}-smart-buttons`}>
      {shown.map((button) => {
        const content = (
          <>
            {button.icon ? <span className="text-muted-foreground">{button.icon}</span> : null}
            <span className="font-semibold tabular-nums">{button.count}</span>
            <span className="text-muted-foreground">{button.label}</span>
          </>
        )
        const testId = `${testIdPrefix}-smart-${button.id}`
        return button.href ? (
          <Link key={button.id} href={button.href} className={buttonClass} data-testid={testId}>
            {content}
          </Link>
        ) : (
          <button
            key={button.id}
            type="button"
            className={buttonClass}
            onClick={button.onClick}
            data-testid={testId}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
