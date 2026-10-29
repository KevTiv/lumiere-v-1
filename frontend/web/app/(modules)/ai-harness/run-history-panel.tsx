"use client"
import { useTranslation } from "@lumiere/i18n"


import type { JsonObject } from "@lumiere/api-client/json-object"

import { useState } from "react"
import { AlertCircle, History } from "lucide-react"
import { Button, buttonVariants } from "@lumiere/ui/components/button"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Skeleton } from "@lumiere/ui/components/skeleton"

import { runStatusLabel, reservationStatusLabel } from "./enum-labels"
import { mapRunHistory, runHistoryRequest, type RunHistoryView } from "./run-history"

type HistoryState =
  | { status: "idle" }
  | { status: "loading"; previous: RunHistoryView | null }
  | { status: "error"; message: string; previous: RunHistoryView | null }
  | { status: "success"; data: RunHistoryView }

export function RunHistoryPanel({ companyId }: { companyId: number | null }) {
  const { t } = useTranslation()
  const [state, setState] = useState<HistoryState>({ status: "idle" })
  const data = state.status === "success" ? state.data : state.status === "loading" || state.status === "error" ? state.previous : null

  const load = async (cursor: string | null, append: boolean) => {
    if (!companyId) return
    const previous = append ? data : null
    setState({ status: "loading", previous })
    try {
      const response = await fetch("/api/ai/evidence/runs/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runHistoryRequest(companyId, cursor)),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (!response.ok) {
        setState({
          status: "error",
          previous,
          message: response.status === 401 || response.status === 403
            ? t("ai-harness.runHistoryPanel.theCurrentSessionIsNotAuthorizedToListGovernedRuns")
            : t("ai-harness.runHistoryPanel.runHistoryIsTemporarilyUnavailable"),
        })
        return
      }
      const mapped = mapRunHistory(payload)
      if (!mapped) {
        setState({ status: "error", previous, message: t("ai-harness.runHistoryPanel.theRunHistoryResponseWasIncomplete") })
        return
      }
      setState({
        status: "success",
        data: append && previous
          ? { runs: [...previous.runs, ...mapped.runs], nextCursor: mapped.nextCursor }
          : mapped,
      })
    } catch {
      setState({ status: "error", previous, message: t("ai-harness.runHistoryPanel.runHistoryIsTemporarilyUnavailable") })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><History className="size-4" /> {" "}{t("ai-harness.runHistoryPanel.recentGovernedRuns")}</CardTitle>
            <CardDescription>{t("ai-harness.runHistoryPanel.newestFirstScopedToTheSelectedCompanyAndCurrentActorGrant")}</CardDescription>
          </div>
          <Button type="button" variant="outline" disabled={!companyId || state.status === "loading"} onClick={() => void load(null, false)}>
            {data ? t("common.refresh") : t("ai-harness.runHistoryPanel.loadHistory")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.status === "idle" ? <p className="text-sm text-muted-foreground">{t("ai-harness.runHistoryPanel.loadAuthorizedHistoryToChooseAnExactRun")}</p> : null}
        {state.status === "loading" && !data ? <Skeleton className="h-28 w-full" /> : null}
        {state.status === "error" ? <Alert><AlertCircle /><AlertTitle>{t("ai-harness.runHistoryPanel.historyUnavailable")}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert> : null}
        {data?.runs.length === 0 ? <p className="text-sm text-muted-foreground">{t("ai-harness.runHistoryPanel.noGovernedRunsWereReturned")}</p> : null}
        {data?.runs.map((run) => (
          <div key={run.runId} className="flex flex-col justify-between gap-3 rounded-md border p-3 md:flex-row md:items-center">
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t("aiHarness.runLifecycle.runNumber", { id: run.runId })}</span>
                <Badge variant="outline">{runStatusLabel(t, run.status)}</Badge>
                <span className="text-xs text-muted-foreground">{t("ai-harness.runHistoryPanel.skill")}{" "}{run.skillId} {" "}{t("ai-harness.runHistoryPanel.agent")}{" "}{run.agentId}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("aiHarness.runMetrics.historySummary", { steps: t("aiHarness.runMetrics.steps", { count: run.stepCount }), tokens: t("aiHarness.runMetrics.tokens", { count: run.tokensUsed }), time: run.startedAt })}</p>
              {run.economics ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {run.economics.providerModels.map((pair) => <Badge key={`${pair.provider}:${pair.model}`} variant="outline">{pair.provider} / {pair.model}</Badge>)}
                  {run.economics.providerModelsTruncated ? <Badge variant="outline">{t("ai-harness.runHistoryPanel.providerListTruncated")}</Badge> : null}
                  {run.economics.settledUnits !== null ? <span>{t("aiHarness.runMetrics.settledAmount", { amount: run.economics.settledUnits.toLocaleString(), currency: run.economics.currency ?? t("ai-harness.runHistoryPanel.units") })}</span> : null}
                  {run.economics.reservedUnits !== null ? <span>{t("aiHarness.runMetrics.reservedAmount", { amount: run.economics.reservedUnits.toLocaleString(), currency: run.economics.currency ?? t("ai-harness.runHistoryPanel.units") })}</span> : null}
                  {run.economics.reservationStatuses.map((status) => <Badge key={`reservation:${status}`} variant="outline">{t("aiHarness.runMetrics.reservationState", { status: reservationStatusLabel(t, status) })}</Badge>)}
                  {run.economics.outcomeUnknown ? <Badge variant="destructive">{t("ai-harness.runHistoryPanel.outcomeUnknown")}</Badge> : null}
                  {run.economics.truncated ? <Badge variant="outline">{t("ai-harness.runHistoryPanel.economicsTruncated")}</Badge> : null}
                </div>
              ) : null}
            </div>
            <a className={buttonVariants({ size: "sm", variant: "outline" })} href={`/ai-harness?tab=evidence-reviewer&companyId=${companyId}&runId=${run.runId}`}>{t("aiHarness.reviewQueue.inspect")}</a>
          </div>
        ))}
        {data?.nextCursor ? (
          <Button type="button" variant="outline" disabled={state.status === "loading"} onClick={() => void load(data.nextCursor, true)}>{t("ai-harness.runHistoryPanel.loadOlderRuns")}</Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
