"use client"

import { Check, CircleDot } from "lucide-react"

import { cn } from "../lib/utils"
import { Badge } from "../components/badge"
import { ExplainPopover } from "../components/contextual-help"
import type { BadgeVariant } from "../lib/entity-view-types"

export interface StatusBarStep {
  id: string
  label: string
  /** Optional plain-language explanation of what this stage represents. */
  description?: string
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
 * The stages of a record as a connected lifecycle rail: finished ones are ticked, the current
 * one is highlighted, and the rest are muted. Preserves all data-testid & data-state contracts.
 */
export function StatusBar({ steps, current, terminal, className }: StatusBarProps) {
  const currentIndex = terminal ? -1 : steps.findIndex((step) => step.id === current)

  return (
    <ol
      aria-label="Status"
      data-testid="status-bar"
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-muted/25 px-2.5 py-1.5 text-xs",
        className,
      )}
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
            className="inline-flex items-center gap-1"
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-3 shrink-0 transition-colors",
                  state === "done" || state === "current" ? "bg-primary/50" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium transition-colors",
                state === "current" && "bg-primary text-primary-foreground shadow-2xs",
                state === "done" && "bg-primary/10 text-primary",
                state === "upcoming" && "text-muted-foreground",
              )}
            >
              {state === "done" ? (
                <Check className="size-3 shrink-0" aria-hidden="true" />
              ) : state === "current" ? (
                <CircleDot className="size-3 shrink-0" aria-hidden="true" />
              ) : (
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
              )}
              <span>{step.label}</span>
              {step.description ? (
                <ExplainPopover
                  title={step.label}
                  description={step.description}
                  icon="info"
                  className={cn(
                    state === "current" &&
                      "text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground",
                  )}
                />
              ) : null}
            </span>
          </li>
        )
      })}
      {terminal ? (
        <li data-testid="status-bar-terminal" aria-current="step" className="ml-1">
          <Badge variant={terminal.variant ?? "destructive"} className="px-2.5 py-0.5 text-xs">
            {terminal.label}
          </Badge>
        </li>
      ) : null}
    </ol>
  )
}
