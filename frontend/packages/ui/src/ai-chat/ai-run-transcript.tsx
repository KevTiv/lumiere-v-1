"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react"

import type {
  AttemptRow,
  CostInfo,
  RunRow,
  StepRow,
} from "@lumiere/query-hooks/hooks/ai-runs"

interface AiRunTranscriptProps {
  run: RunRow
  steps: StepRow[]
  attempts: AttemptRow[]
  cost: CostInfo
  loading?: boolean
}

/** Sensible badge color mapping for run statuses (shared with the Runs tab). */
export function aiRunStatusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default"
    case "failed":
      return "destructive"
    case "running":
    case "awaiting_approval":
    case "agent_settled":
      return "secondary"
    // pending, cancelled and unknown statuses stay neutral
    default:
      return "outline"
  }
}

function formatMicros(micros: number | null | undefined): string {
  if (micros == null || !Number.isFinite(micros)) return "—"
  return new Date(micros / 1000).toLocaleString()
}

const SUMMARY_CLAMP_THRESHOLD = 160

function StepItem({ step }: { step: StepRow }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const failed = step.error_message != null && step.error_message !== ""
  const canToggle = step.output_summary.length > SUMMARY_CLAMP_THRESHOLD

  return (
    <li
      data-testid="ai-run-step"
      data-step-no={step.step_no}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        failed && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          #{step.step_no}
        </span>
        <Badge variant="outline" className="font-mono">
          {step.tool_name}
        </Badge>
        {failed && (
          <Badge variant="destructive" data-testid="ai-run-step-denied">
            {t("aiHarness.transcript.stepDenied")}
          </Badge>
        )}
        {step.output_row_count != null && (
          <Badge variant="secondary">
            {t("aiHarness.transcript.stepRows", { count: step.output_row_count })}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {t("aiHarness.transcript.durationMs", { count: step.duration_ms })}
        </span>
      </div>

      {step.output_summary !== "" && (
        <div className="flex flex-col gap-1">
          <p
            title={step.output_summary}
            className={cn(
              "whitespace-pre-wrap break-words text-sm text-muted-foreground",
              !expanded && canToggle && "line-clamp-2",
            )}
          >
            {step.output_summary}
          </p>
          {canToggle && (
            <button
              type="button"
              className="flex w-fit items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp /> : <ChevronDown />}
              {expanded
                ? t("aiHarness.transcript.showLess")
                : t("aiHarness.transcript.showMore")}
            </button>
          )}
        </div>
      )}

      {failed && (
        <p
          data-testid="ai-run-step-error"
          className="break-words text-xs text-destructive"
        >
          {step.error_message}
        </p>
      )}
    </li>
  )
}

/**
 * Live run transcript (AIH-7) with provider/cost indicator (AIH-8).
 * Presentational: the parent feeds it from `useAiRunSteps` polling.
 */
export function AiRunTranscript({
  run,
  steps,
  attempts,
  cost,
  loading = false,
}: AiRunTranscriptProps) {
  const { t } = useTranslation()
  const inFlight = run.status === "pending" || run.status === "running"
  const latestAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null
  const skillLabel = run.skill_name ?? run.skill_key
  const costValue = cost.settled_units ?? cost.reserved_units
  const costLabel =
    cost.available && costValue != null
      ? t("aiHarness.transcript.costValue", {
        value: costValue,
        currency: cost.currency ?? "—",
      })
      : t("aiHarness.transcript.costPending")

  return (
    <Card data-testid="ai-run-transcript">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {t("aiHarness.transcript.title")}
          </CardTitle>
          <Badge
            variant={aiRunStatusBadgeVariant(run.status)}
            data-testid="ai-run-transcript-status"
          >
            {run.status}
          </Badge>
          {inFlight && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <span
            data-testid="ai-run-provider-cost"
            className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          >
            {latestAttempt && (
              <span className="font-mono">
                {latestAttempt.provider} · {latestAttempt.model} ·{" "}
                {t("aiHarness.transcript.attemptTokens", {
                  input: latestAttempt.input_tokens,
                  output: latestAttempt.output_tokens,
                })}
              </span>
            )}
            <span>{costLabel}</span>
          </span>
        </div>
        <CardDescription>
          {t("aiHarness.transcript.runMeta", {
            id: run.id,
            date: formatMicros(run.started_at),
          })}
          {skillLabel != null && skillLabel !== "" ? ` · ${skillLabel}` : ""}
        </CardDescription>
        {run.error_message != null && run.error_message !== "" && (
          <p
            data-testid="ai-run-transcript-error"
            className="flex items-start gap-2 break-words text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {run.error_message}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {attempts.length > 1 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("aiHarness.transcript.attemptsTitle")}
            </p>
            <ul className="flex flex-col gap-1">
              {attempts.map((attempt) => (
                <li
                  key={attempt.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground"
                >
                  <span>
                    {attempt.provider} · {attempt.model}
                  </span>
                  <Badge variant="outline">{attempt.status}</Badge>
                  <span>
                    {t("aiHarness.transcript.attemptTokens", {
                      input: attempt.input_tokens,
                      output: attempt.output_tokens,
                    })}
                  </span>
                  {attempt.failure_reason != null &&
                    attempt.failure_reason !== "" && (
                      <span className="text-destructive">
                        {attempt.failure_reason}
                      </span>
                    )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading && steps.length === 0 ? (
          <div className="flex flex-col gap-2" data-testid="ai-run-transcript-skeleton">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : steps.length === 0 ? (
          <p
            data-testid="ai-run-transcript-empty"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            {inFlight && <Loader2 className="size-4 animate-spin" />}
            {inFlight
              ? t("aiHarness.transcript.waitingSteps")
              : t("aiHarness.transcript.emptySteps")}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {steps.map((step) => (
              <StepItem key={step.id} step={step} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
