"use client"

import { useEffect, useState } from "react"
import { Button } from "@lumiere/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@lumiere/ui/components/dialog"

import { apiFetch } from "./api-fetch"

const QUEUES = [
  ["crm_opportunities", "CRM opportunities"],
  ["warehouse_transfers", "Warehouse transfers"],
  ["fleet_inspections", "Fleet inspections"],
  ["workflow_instances", "Workflow instances"],
  ["approval_inbox", "Approval inbox"],
] as const

type View = "coverage" | "purchasing_reconciliation" | "compare_activity" | (typeof QUEUES)[number][0]
type Coverage = {
  module: string
  source?: string
  status: string
  observedRows?: number
  sampleFirstDate?: string
  sampleLastDate?: string
  reason?: string
}
type Period = { from: string; through: string; count: number }
type ActivityRequest = { source: string; from: string; through: string }
type Result = {
  summary: string
  data: {
    activity?: { source: string; dateField: string; current: Period; baseline: Period; change: number }
    sources?: Coverage[]
    counts?: Record<string, number>
    atRowLimit?: boolean
    proposals?: {
      moveId: number
      pickingId: number
      purchaseOrderId: number
      purchaseLineId: number
      quantity: number
    }[]
    unresolvedMoveIds?: number[]
    unresolvedCount?: number
    truncated?: boolean
  }
}

export function ChatAlphaAnalytics({ companyId, companyName }: { companyId: number; companyName?: string }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>("coverage")
  const [result, setResult] = useState<Result>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [activity, setActivity] = useState<ActivityRequest>()

  useEffect(() => {
    if (!open || (view === "compare_activity" && !activity)) return
    const controller = new AbortController()
    const operation = view === "coverage" || view === "purchasing_reconciliation" || view === "compare_activity"
      ? view : "queue"
    const body = operation === "queue" ? { companyId, operation, queue: view }
      : operation === "compare_activity" ? { companyId, operation, ...activity } : { companyId, operation }
    void (async () => {
      try {
        const response = await apiFetch("/api/ai/alpha-analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error("Analysis unavailable")
        const data: Result = await response.json()
        if (!data || typeof data.summary !== "string" || !data.data) throw new Error("Invalid analysis response")
        if (!controller.signal.aborted) setResult(data)
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    })()
    return () => controller.abort()
  }, [activity, attempt, companyId, open, view])

  function reset() {
    setError(false)
    setResult(undefined)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { reset(); setOpen(next) }}>
      <Button type="button" variant="outline" onClick={() => { reset(); setOpen(true) }}>
        Analyze company data
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>Company analytics</DialogTitle>
        <DialogDescription>{companyName ?? `Company ${companyId}`} · Authorized data preview</DialogDescription>
        <label className="grid gap-1 text-sm">
          Analysis
          <select className="rounded-md border bg-background p-2" value={view} onChange={(event) => {
            reset()
            setActivity(undefined)
            setView(event.target.value as View)
          }}>
            <option value="coverage">Data coverage</option>
            <option value="compare_activity">Compare period activity</option>
            <option value="purchasing_reconciliation">Purchase receipt links</option>
            {QUEUES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {view === "compare_activity" && (
          <form className="grid items-end gap-2 sm:grid-cols-4" onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            reset()
            setActivity({
              source: String(form.get("source")),
              from: String(form.get("from")),
              through: String(form.get("through")),
            })
          }}>
            <label className="grid gap-1 text-sm">Source
              <select name="source" className="rounded-md border bg-background p-2">
                <option value="sales">Sales orders</option>
                <option value="purchasing">Purchase orders</option>
                <option value="expenses">Expenses</option>
                <option value="subscriptions">Subscription starts</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">From
              <input name="from" type="date" required className="rounded-md border bg-background p-2" />
            </label>
            <label className="grid gap-1 text-sm">Through
              <input name="through" type="date" required className="rounded-md border bg-background p-2" />
            </label>
            <Button type="submit">Compare</Button>
          </form>
        )}
        {view === "compare_activity" && !activity ? null : error ? <div role="alert" className="space-y-2">
          <p>This analysis is unavailable for the selected company and access level.</p>
          <Button type="button" variant="outline" onClick={() => { reset(); setAttempt((value) => value + 1) }}>Retry</Button>
        </div> : !result ? <p role="status">Reading company data…</p> : <AnalyticsResult result={result} />}
      </DialogContent>
    </Dialog>
  )
}

function AnalyticsResult({ result }: { result: Result }) {
  const { activity, sources, counts, atRowLimit, proposals, unresolvedCount, unresolvedMoveIds, truncated } = result.data
  return (
    <div className="space-y-3 text-sm">
      <p>{result.summary}</p>
      {activity && (
        <dl className="grid gap-2">
          <div><dt>Selected period · {activity.current.from} to {activity.current.through}</dt><dd>{activity.current.count} records</dd></div>
          <div><dt>Previous period · {activity.baseline.from} to {activity.baseline.through}</dt><dd>{activity.baseline.count} records</dd></div>
          <div><dt>Change</dt><dd>{activity.change > 0 ? "+" : ""}{activity.change} records</dd></div>
          <div><dt>Source</dt><dd>{activity.source} · {activity.dateField}</dd></div>
        </dl>
      )}
      {sources && (
        <>
          <p className="text-muted-foreground">Dates and row counts describe the observed sample.</p>
          <dl className="divide-y">
            {sources.map((source) => (
              <div key={source.module} className="grid gap-1 py-2 sm:grid-cols-2">
                <dt className="capitalize">{source.module.replaceAll("-", " ")}</dt>
                <dd>
                  {source.status}
                  {source.observedRows != null && ` · ${source.observedRows} rows observed`}
                  {source.sampleFirstDate && <div>{source.sampleFirstDate} to {source.sampleLastDate}</div>}
                  <div className="text-muted-foreground">{source.reason ?? source.source}</div>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {counts && (
        <>
          {atRowLimit && <p>The read reached its row limit. Counts may be incomplete.</p>}
          <ul>{Object.entries(counts).map(([state, count]) => <li key={state}>{state.replaceAll("_", " ")} · {count}</li>)}</ul>
        </>
      )}
      {proposals && (
        <>
          <p>{unresolvedCount ?? 0} unresolved stock movements. {truncated && "Showing the first 20 in each result list."}</p>
          {proposals.length === 0 && <p>No receipt link candidates found in this read.</p>}
          <ul className="space-y-1">
            {proposals.map((item) => <li key={item.moveId}>
              Receipt #{item.pickingId}, movement #{item.moveId} → purchase order #{item.purchaseOrderId}, line #{item.purchaseLineId} · {item.quantity}
            </li>)}
          </ul>
          {!!unresolvedMoveIds?.length && <p>Unresolved movements · {unresolvedMoveIds.join(", ")}</p>}
        </>
      )}
    </div>
  )
}
