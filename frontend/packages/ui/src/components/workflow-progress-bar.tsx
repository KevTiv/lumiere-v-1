"use client"

import * as React from "react"
import { Check, CircleDot, Lock, XCircle } from "lucide-react"

import { cn } from "../lib/utils"
import { BlockerPopover, ExplainPopover } from "./contextual-help"

export type WorkflowStageState = "completed" | "current" | "upcoming" | "cancelled" | "blocked"

export interface WorkflowStageItem {
  id: string
  label: string
  /** Optional plain-language description of what this stage means or requires. */
  description?: string
  /** Optional explicit state override (otherwise inferred from `currentStageId`). */
  state?: WorkflowStageState
}

export interface WorkflowProgressBarProps {
  stages: ReadonlyArray<WorkflowStageItem>
  /** Active stage ID. Stages before it are marked completed; stages after are upcoming. */
  currentStageId?: string | null
  /** Optional terminal cancelled/rejected badge shown alongside the trail. */
  cancelledLabel?: string
  /** Optional active blocker explaining why the record cannot advance yet. */
  blockedReason?: string | null
  /** Optional remediation hint shown inside the blocker popover. */
  blockedRemediation?: string
  className?: string
  testId?: string
}

/**
 * Linear-caliber horizontal lifecycle progress bar answering "Where do I stand?"
 * at a glance on record headers (Invoices, Bills, Orders, Expenses, Transfers).
 */
export function WorkflowProgressBar({
  stages,
  currentStageId,
  cancelledLabel,
  blockedReason,
  blockedRemediation,
  className,
  testId = "workflow-progress-bar",
}: WorkflowProgressBarProps) {
  if (stages.length === 0) return null

  const currentIndex = currentStageId
    ? stages.findIndex((stage) => stage.id === currentStageId)
    : -1

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center gap-y-2 rounded-lg border border-border/60 bg-muted/25 px-3 py-2",
        className,
      )}
    >
      <ol
        aria-label="Workflow progress"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
      >
        {stages.map((stage, index) => {
          const inferred: WorkflowStageState =
            stage.state ??
            (cancelledLabel
              ? "upcoming"
              : currentIndex >= 0
                ? index < currentIndex
                  ? "completed"
                  : index === currentIndex
                    ? blockedReason
                      ? "blocked"
                      : "current"
                    : "upcoming"
                : "upcoming")

          const isCurrent = inferred === "current" || inferred === "blocked"
          const isCompleted = inferred === "completed"

          const pill = (
            <span
              aria-current={isCurrent ? "step" : undefined}
              data-stage-id={stage.id}
              data-stage-state={inferred}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                isCompleted && "bg-primary/10 text-primary",
                inferred === "current" && "bg-primary text-primary-foreground shadow-xs",
                inferred === "blocked" &&
                  "bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/40 dark:text-amber-300",
                inferred === "upcoming" && "text-muted-foreground",
                inferred === "cancelled" && "bg-destructive/10 text-destructive line-through",
              )}
            >
              {isCompleted ? (
                <Check className="size-3 shrink-0" aria-hidden="true" />
              ) : inferred === "blocked" ? (
                <Lock className="size-3 shrink-0" aria-hidden="true" />
              ) : inferred === "current" ? (
                <CircleDot className="size-3 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                  aria-hidden="true"
                />
              )}
              <span>{stage.label}</span>
              {stage.description ? (
                <ExplainPopover
                  title={stage.label}
                  description={stage.description}
                  icon="info"
                  className={cn(
                    inferred === "current" &&
                      "text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground",
                  )}
                />
              ) : null}
            </span>
          )

          return (
            <li key={stage.id} className="inline-flex items-center gap-1.5">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-4 shrink-0 transition-colors",
                    isCompleted || isCurrent ? "bg-primary/50" : "bg-border",
                  )}
                />
              )}
              {inferred === "blocked" && blockedReason ? (
                <BlockerPopover
                  title={`${stage.label} blocked`}
                  reason={blockedReason}
                  remediation={blockedRemediation}
                  tone="warning"
                >
                  {pill}
                </BlockerPopover>
              ) : (
                pill
              )}
            </li>
          )
        })}
      </ol>

      {cancelledLabel ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
          <XCircle className="size-3 shrink-0" aria-hidden="true" />
          {cancelledLabel}
        </span>
      ) : null}
    </div>
  )
}
