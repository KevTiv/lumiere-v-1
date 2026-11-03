"use client"

import type { JsonObject } from "@lumiere/api-client/json-object"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { AlertCircle, History } from "lucide-react"
import { Button, buttonVariants } from "@lumiere/ui/components/button"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Skeleton } from "@lumiere/ui/components/skeleton"

import { mapRunHistory, runHistoryRequest, type RunHistoryView } from "./run-history"
import { runStatusLabel } from "./enum-labels"

type HistoryPageRequest = { cursor: string | null; append: boolean }

type HistoryState =
  | { status: "idle" }
  | { status: "loading"; previous: RunHistoryView | null }
  | { status: "error"; reason: "unavailable" | "incomplete"; previous: RunHistoryView | null; retry: HistoryPageRequest }
  | { status: "denied"; reason: "signedOut" | "forbidden" }
  | { status: "success"; data: RunHistoryView }

export function RunHistoryPanel({ companyId, onSelectRun, selectRunDisabled = false }: {
  companyId: number | null
  onSelectRun?: (runId: number) => void
  selectRunDisabled?: boolean
}) {
  const { t } = useTranslation()
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => () => activeRequest.current?.abort(), [])
  const [state, setState] = useState<HistoryState>({ status: "idle" })
  const data = state.status === "success" ? state.data : state.status === "loading" || state.status === "error" ? state.previous : null

  const load = async (cursor: string | null, append: boolean) => {
    if (!companyId) return
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const retry = { cursor, append }
    const previous = data
    setState({ status: "loading", previous })
    try {
      const response = await fetch("/api/ai/evidence/runs/history", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runHistoryRequest(companyId, cursor)),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (controller.signal.aborted) return
      if (response.status === 401 || response.status === 403) {
        // An access failure must remove previously loaded run metadata too.
        setState({ status: "denied", reason: response.status === 401 ? "signedOut" : "forbidden" })
        return
      }
      if (!response.ok) {
        setState({ status: "error", previous, retry, reason: "unavailable" })
        return
      }
      const mapped = mapRunHistory(payload)
      if (!mapped) {
        setState({ status: "error", previous, retry, reason: "incomplete" })
        return
      }
      setState({
        status: "success",
        data: append && previous
          ? { runs: [...previous.runs, ...mapped.runs], nextCursor: mapped.nextCursor }
          : mapped,
      })
    } catch {
      if (!controller.signal.aborted) setState({ status: "error", previous, retry, reason: "unavailable" })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><History className="size-4" /> {t("aiHarness.runHistory.title")}</CardTitle>
            <CardDescription>{t("aiHarness.runHistory.description")}</CardDescription>
          </div>
          {state.status !== "error" && state.status !== "denied" ? (
            <Button type="button" variant="outline" disabled={!companyId || state.status === "loading"} onClick={() => void load(null, false)}>
              {data ? t("common.refresh") : t("aiHarness.runHistory.load")}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3" aria-busy={state.status === "loading"}>
        {state.status === "loading" ? <span role="status" className="sr-only">{t("common.loading")}</span> : null}
        {state.status === "idle" ? <p className="text-sm text-muted-foreground">{t("aiHarness.runHistory.idle")}</p> : null}
        {state.status === "loading" && !data ? <Skeleton className="h-28 w-full" /> : null}
        {state.status === "error" ? (
          <Alert>
            <AlertCircle />
            <AlertTitle>{t("aiHarness.runHistory.unavailableTitle")}</AlertTitle>
            <AlertDescription>
              <p>{t(`aiHarness.runHistory.${state.reason}`)}</p>
              <Button type="button" variant="outline" className="mt-2" onClick={() => void load(state.retry.cursor, state.retry.append)}>{t("aiHarness.runHistory.retry")}</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {state.status === "denied" ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t("aiHarness.runHistory.deniedTitle")}</AlertTitle>
            <AlertDescription>
              <p>{t(`aiHarness.runHistory.${state.reason}`)}</p>
              <Button type="button" variant="outline" className="mt-2" onClick={() => void load(null, false)}>{t("aiHarness.runHistory.checkAccess")}</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {state.status === "success" && data?.runs.length === 0 ? <p className="text-sm text-muted-foreground">{t("aiHarness.runHistory.empty")}</p> : null}
        {data?.runs.map((run) => (
          <div key={run.runId} className="flex flex-col justify-between gap-3 rounded-md border p-3 md:flex-row md:items-center">
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t("aiHarness.runHistory.run", { id: run.runId })}</span>
                <Badge variant="outline">{runStatusLabel(t, run.status)}</Badge>
                <span className="text-xs text-muted-foreground">{t("aiHarness.runHistory.identifiers", { skill: run.skillId, agent: run.agentId })}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("aiHarness.runHistory.summary", { steps: run.stepCount, tokens: run.tokensUsed.toLocaleString(), started: run.startedAt })}</p>
              {run.economics ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {run.economics.providerModels.map((pair) => <Badge key={`${pair.provider}:${pair.model}`} variant="outline">{pair.provider} / {pair.model}</Badge>)}
                  {run.economics.providerModelsTruncated ? <Badge variant="outline">{t("aiHarness.runHistory.providersTruncated")}</Badge> : null}
                  {run.economics.settledUnits !== null ? <span>{t("aiHarness.runHistory.settled", { amount: run.economics.settledUnits.toLocaleString(), currency: run.economics.currency ?? t("aiHarness.runHistory.units") })}</span> : null}
                  {run.economics.reservedUnits !== null ? <span>{t("aiHarness.runHistory.reserved", { amount: run.economics.reservedUnits.toLocaleString(), currency: run.economics.currency ?? t("aiHarness.runHistory.units") })}</span> : null}
                  {run.economics.reservationStatuses.map((status) => <Badge key={`reservation:${status}`} variant="outline">{t("aiHarness.runHistory.reservationStatus", { status })}</Badge>)}
                  {run.economics.outcomeUnknown ? <Badge variant="destructive">{t("aiHarness.runHistory.outcomeUnknown")}</Badge> : null}
                  {run.economics.truncated ? <Badge variant="outline">{t("aiHarness.runHistory.economicsTruncated")}</Badge> : null}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {onSelectRun ? <Button type="button" size="sm" disabled={selectRunDisabled || state.status === "loading"} onClick={() => onSelectRun(run.runId)}>{t("aiHarness.runHistory.openRun", { defaultValue: "Open run" })}</Button> : null}
              <a className={buttonVariants({ size: "sm", variant: "outline" })} href={`/ai-harness?tab=evidence-reviewer&companyId=${companyId}&runId=${run.runId}`}>{t("aiHarness.runHistory.inspect")}</a>
            </div>
          </div>
        ))}
        {data?.nextCursor && state.status !== "error" ? (
          <Button type="button" variant="outline" disabled={state.status === "loading"} onClick={() => void load(data.nextCursor, true)}>{t("aiHarness.runHistory.loadOlder")}</Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
