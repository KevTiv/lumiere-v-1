"use client"

import { Check } from "lucide-react"

import { cn } from "../lib/utils"
import { Badge } from "../components/badge"
import type { BadgeVariant } from "../lib/entity-view-types"

export interface StatusBarStep {
  id: string
  label: string
}

export interface StatusBarProps {
  /** The stages a record moves through, in order. */
  steps: ReadonlyArray<StatusBarStep>
  /** Id of the stage the record is in. A value outside `steps` leaves every stage upcoming. */
  current: string
  /**
   * A state outside the normal flow (cancelled, rejected). Stages are muted and this is shown
   * after them instead of a current stage.
   */
  terminal?: { label: string; variant?: BadgeVariant }
  className?: string
}

/**
 * The stages of a record as a row: finished ones are ticked, the current one is highlighted, the
 * rest are muted. Presentation only; the record's actions are what change its stage.
 */
export function StatusBar({ steps, current, terminal, className }: StatusBarProps) {
  const currentIndex = terminal ? -1 : steps.findIndex((step) => step.id === current)

  return (
    <ol
      aria-label="Status"
      data-testid="status-bar"
      className={cn("flex flex-wrap items-center gap-1.5 text-sm", className)}
    >
      {steps.map((step, index) => {
        const state =
          currentIndex === -1 ? "upcoming" : index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming"
        return (
          <li
            key={step.id}
            data-testid={`status-bar-step-${step.id}`}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
              state === "current" && "border-primary bg-primary text-primary-foreground font-medium",
              state === "done" && "border-border bg-muted text-foreground",
              state === "upcoming" && "border-dashed border-border text-muted-foreground",
            )}
          >
            {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {step.label}
          </li>
        )
      })}
      {terminal ? (
        <li data-testid="status-bar-terminal" aria-current="step">
          <Badge variant={terminal.variant ?? "destructive"} className="px-3 py-1 text-sm">
            {terminal.label}
          </Badge>
        </li>
      ) : null}
    </ol>
  )
}
