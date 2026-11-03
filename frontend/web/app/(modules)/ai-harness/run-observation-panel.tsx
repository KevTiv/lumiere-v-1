"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { mapRunObservation, type RunObservationView } from "./run-observation"
import { runStatusLabel } from "./enum-labels"
import { HarnessInspector } from "./harness-inspector"

export type ObservationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "success"; data: RunObservationView }

/** Read one saved run without lifecycle authority or another provider request. */
export function SavedRunObservation({ companyId, runId }: { companyId: number; runId: number }) {
  const { t } = useTranslation()
  const [observation, setObservation] = useState<ObservationState>({ status: "loading" })
  useEffect(() => {
    const controller = new AbortController()
    setObservation({ status: "loading" })
    void (async () => {
      try {
        const response = await fetch("/api/ai/evidence/runs/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, runId }),
          signal: controller.signal,
        })
        const payload: unknown = await response.json().catch(() => null)
        if (controller.signal.aborted) return
        if (!response.ok) {
          const key = response.status === 401 || response.status === 403
            ? "transcriptUnauthorized"
            : response.status === 404 ? "transcriptNotFound" : "transcriptUnavailable"
          setObservation({ status: "unavailable", message: t(`aiHarness.runLifecycle.errors.${key}`) })
          return
        }
        const mapped = mapRunObservation(payload)
        setObservation(mapped && mapped.runId === runId
          ? { status: "success", data: mapped }
          : { status: "unavailable", message: t("aiHarness.runLifecycle.errors.transcriptIncomplete") })
      } catch {
        if (!controller.signal.aborted) {
          setObservation({ status: "unavailable", message: t("aiHarness.runLifecycle.errors.transcriptUnavailable") })
        }
      }
    })()
    return () => controller.abort()
  }, [companyId, runId, t])
  return <RunObservation observation={observation} />
}

export function RunObservation({ observation }: { observation: ObservationState }) {
  const { t } = useTranslation()
  if (observation.status === "idle") return null
  if (observation.status === "loading") return <Skeleton className="h-48 w-full" />
  if (observation.status === "unavailable") {
    return <Alert><AlertCircle /><AlertTitle>{t("aiHarness.runLifecycle.transcriptUnavailable")}</AlertTitle><AlertDescription>{observation.message}</AlertDescription></Alert>
  }

  const run = observation.data
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("aiHarness.runLifecycle.transcriptTitle")}</CardTitle>
            <CardDescription>{t("aiHarness.runLifecycle.transcriptDescription")}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t("aiHarness.runLifecycle.runNumber", { id: run.runId })}</Badge>
            <Badge variant="outline">{runStatusLabel(t, run.status)}</Badge>
            <Badge variant="outline">{t("aiHarness.runLifecycle.stepCount", { count: run.stepCount })}</Badge>

          </div>
        </div>
      </CardHeader>
      <CardContent>
        {run.economics?.outcomeUnknown ? <p role="status" className="mb-3 text-sm font-medium">{t("aiHarness.ux.observation.unknown", { defaultValue: "The result of a provider request is unknown. Inspect the history before starting another request." })}</p> : null}
        {run.economics?.settledUnits != null ? <p className="mb-3 text-sm">{t("aiHarness.ux.observation.settled", { defaultValue: "Settled usage: {{amount}} {{currency}}", amount: (run.economics.settledUnits / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 }), currency: run.economics.currency ?? "units" })}</p> : null}
        {run.transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("aiHarness.runLifecycle.noToolSteps")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {run.transcript.map((step) => (
              <li key={step.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t("aiHarness.runLifecycle.stepNumber", { number: step.stepNo })}</Badge>

                    {step.error ? <Badge variant="destructive">{t("aiHarness.runLifecycle.failed")}</Badge> : <Badge variant="outline">{t("aiHarness.runLifecycle.completed")}</Badge>}
                  </div>

                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{step.resultSummary}</span>

                </div>
              </li>
            ))}
          </ol>
        )}
        <HarnessInspector title={t("aiHarness.inspector.execution", { defaultValue: "Technical inspector: execution trace and usage" })}>
          {run.tokensUsed !== null ? <p className="text-sm">{t("aiHarness.runLifecycle.tokenCount", { count: run.tokensUsed })}</p> : null}
        {run.economics ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            {run.economics.providerModels.map((pair) => <Badge key={`${pair.provider}:${pair.model}`} variant="outline">{pair.provider} / {pair.model}</Badge>)}
            {run.economics.providerModelsTruncated ? <Badge variant="outline">Provider list truncated</Badge> : null}
            {run.economics.attemptCount !== null ? <span>{run.economics.attemptCount} provider attempt{run.economics.attemptCount === 1 ? "" : "s"}</span> : null}
            {run.economics.inputTokens !== null && run.economics.outputTokens !== null ? <span>{run.economics.inputTokens.toLocaleString()} input / {run.economics.outputTokens.toLocaleString()} output tokens</span> : null}
            {run.economics.reservedUnits !== null ? <span>{(run.economics.reservedUnits / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} {run.economics.currency ?? "units"} reserved</span> : null}
            {run.economics.settledUnits !== null ? <span>{(run.economics.settledUnits / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} {run.economics.currency ?? "units"} settled</span> : null}
            {run.economics.attemptStatuses.map((status) => <Badge key={`attempt:${status}`} variant="outline">attempt {status}</Badge>)}
            {run.economics.reservationStatuses.map((status) => <Badge key={`reservation:${status}`} variant="outline">reservation {status}</Badge>)}
            {run.economics.outcomeUnknown ? <Badge variant="destructive">Outcome unknown</Badge> : null}
            {run.economics.truncated ? <Badge variant="outline">Economics truncated</Badge> : null}
          </div>
        ) : null}
          <ol className="flex min-w-0 flex-col gap-3">{run.transcript.map((step) => <li key={step.id} className="text-xs">
            <p>{t("aiHarness.runLifecycle.stepNumber", { number: step.stepNo })}: <code>{step.toolName}</code></p>
            <p>{t("aiHarness.runLifecycle.durationMs", { duration: step.durationMs.toLocaleString() })}</p>
            {step.inputHash ? <p><code>{step.inputHash}</code></p> : null}
          </li>)}</ol>
        </HarnessInspector>
      </CardContent>
    </Card>
  )
}
