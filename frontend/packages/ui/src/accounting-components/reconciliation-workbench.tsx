"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "../components/button"
import { Input } from "../components/input"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { workspaceStyles } from "../lib/workspace-styles"
import { cn } from "../lib/utils"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"
import { projectReconciliation, reconciliationId, reconciliationSelection, type ReconciliationContext, type ReconciliationProjection, type ReconciliationRequest, type ReconciliationSource } from "./reconciliation-workbench-model"

export type ReconciliationOutcome = { status: "awaiting_approval"; paymentId: string } | { status: "confirmed" } | { status: "rejected"; message: string } | { status: "unknown"; message?: string }
export interface ReconciliationWorkbenchProps {
  source: ReconciliationSource
  canReconcile: boolean
  onConfirm: (request: ReconciliationRequest) => Promise<ReconciliationOutcome>
  /** Read-only exact-scope recovery; never resubmits a reconciliation command. */
  onCheckStatus?: (request: ReconciliationRequest) => Promise<"confirmed" | "unconfirmed" | { status: "awaiting_approval"; paymentId: string }>
  onFindMatches?: (context: ReconciliationContext) => Promise<void>
  onApplyRules?: (context: ReconciliationContext) => Promise<void>
  onOperationLockChange?: (locked: boolean) => void
}
type ReadyProjection = Extract<ReconciliationProjection, { status: "ready" }>
interface ReviewedOperation {
  request: ReconciliationRequest
  projection: ReadyProjection
  selectedIds: readonly string[]
  status: "pending" | "unknown" | "confirmed" | "awaiting_approval"
  paymentId?: string
  message?: string
}
function money(value: number | null, context: ReconciliationContext): string {
  if (value === null) return "Unavailable"
  const formatted = new Intl.NumberFormat(undefined, {
    ...(context.currencyCode ? { style: "currency", currency: context.currencyCode, currencyDisplay: "code" } : {}),
    minimumFractionDigits: context.decimalPlaces, maximumFractionDigits: context.decimalPlaces,
  }).format(value)
  return context.currencyCode ? formatted : `${formatted} · Currency #${context.currencyId}`
}
const touchButton = "min-h-11 h-auto whitespace-normal px-3 py-2 text-left [overflow-wrap:anywhere]"

/** A reviewed exact-amount settlement, preserving payment approval boundaries. */
export function ReconciliationWorkbench({ source, canReconcile, onConfirm, onCheckStatus, onFindMatches, onApplyRules, onOperationLockChange }: ReconciliationWorkbenchProps) {
  const live = projectReconciliation(source)
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] })
  const [reviewedSignature, setReviewedSignature] = useState<string | null>(null)
  const [operation, setOperation] = useState<ReviewedOperation | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  const operationLocked = operation?.status === "pending" || operation?.status === "unknown"
  const navigationDialog = useUnsavedChangesGuard(false, operationLocked)
  useEffect(() => { onOperationLockChange?.(operationLocked) }, [operationLocked, onOperationLockChange])
  // React state alone cannot prevent two clicks before the pending render commits.
  const busy = useRef(false)
  const projection = operation?.projection ?? live
  const selectedIds = operation?.selectedIds ?? (projection.status === "ready" && selection.key === projection.context.key ? selection.ids : [])
  const review = reconciliationSelection(projection, selectedIds)
  const signature = projection.status === "ready" ? JSON.stringify([projection.context, review.selected]) : ""
  const reviewed = reviewedSignature === signature
  const locked = operation !== null || suggestionBusy
  const scopeMatches = operation === null || (reconciliationId(source.organizationId) === operation.request.organizationId && reconciliationId(source.companyId) === operation.request.companyId)
  const mayDisplayReview = source.state.status === "ready" && scopeMatches
  const searchValue = search.trim().toLocaleLowerCase()
  const candidates = projection.status === "ready" ? projection.candidates.filter((row) => [row.documentLabel, row.description, row.partner, row.accountLabel].some((value) => value.toLocaleLowerCase().includes(searchValue))) : []
  const toggle = (id: string) => {
    if (locked || !canReconcile || live.status !== "ready") return
    setReviewedSignature(null)
    setSelection({ key: live.context.key, ids: selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id] })
  }
  const submit = async () => {
    if (busy.current || operation || !canReconcile || live.status !== "ready" || !reviewed || !review.request || !mayDisplayReview) return
    const request: ReconciliationRequest = Object.freeze({ ...review.request, moveLineIds: Object.freeze([...review.request.moveLineIds]) })
    const captured: ReviewedOperation = { request, projection: live, selectedIds: [...selectedIds], status: "pending" }
    busy.current = true
    onOperationLockChange?.(true)
    setOperation(captured)
    setMessage(null)
    setReviewedSignature(null)
    try {
      const result = await onConfirm(request)
      if (result.status === "rejected") { setOperation(null); setMessage(result.message); onOperationLockChange?.(false) }
      else {
        setOperation({ ...captured, status: result.status, ...(result.status === "unknown" ? { message: result.message } : {}), ...(result.status === "awaiting_approval" ? { paymentId: result.paymentId } : {}) })
        if (result.status === "confirmed" || result.status === "awaiting_approval") onOperationLockChange?.(false)
      }
    } catch {
      setOperation({ ...captured, status: "unknown", message: "The result could not be confirmed. Check the original action before continuing." })
    } finally { busy.current = false }
  }
  const check = async () => {
    if (busy.current || (operation?.status !== "unknown" && operation?.status !== "awaiting_approval") || !onCheckStatus) return
    busy.current = true
    setChecking(true)
    try {
      const result = await onCheckStatus(operation.request)
      setOperation({ ...operation, status: typeof result === "object" ? "awaiting_approval" : result === "confirmed" ? "confirmed" : "unknown", ...(typeof result === "object" ? { paymentId: result.paymentId } : {}), message: result === "unconfirmed" ? "The original action is still unconfirmed. Nothing has been resubmitted." : undefined })
    } catch {
      setOperation({ ...operation, message: "The original action could not be checked. Keep this review and check again when access returns." })
    } finally { busy.current = false; setChecking(false) }
  }
  const completeApproved = async () => {
    if (busy.current || operation?.status !== "awaiting_approval" || !scopeMatches || source.state.status !== "ready") return
    busy.current = true
    const captured = operation
    setOperation({ ...captured, status: "pending" })
    try {
      const result = await onConfirm(captured.request)
      if (result.status === "rejected") setOperation({ ...captured, message: result.message })
      else setOperation({ ...captured, status: result.status,
        ...(result.status === "awaiting_approval" ? { paymentId: result.paymentId } : {}),
        ...(result.status === "unknown" ? { message: result.message } : { message: undefined }) })
    } catch {
      setOperation({ ...captured, status: "unknown", message: "The completion result could not be confirmed. Check the original action before trying again." })
    } finally { busy.current = false }
  }
  const find = async (callback: ((context: ReconciliationContext) => Promise<void>) | undefined) => {
    if (busy.current || locked || live.status !== "ready" || !callback) return
    busy.current = true
    setSuggestionBusy(true)
    setMessage(null)
    setReviewedSignature(null)
    try { await callback(live.context) } catch (error) { setMessage(error instanceof Error ? error.message : "Suggestions could not be refreshed.") }
    finally { busy.current = false; setSuggestionBusy(false) }
  }
  return <section className="@container min-w-0 space-y-4 [overflow-wrap:anywhere]" aria-label="Bank matching desk" data-testid="reconciliation-workbench">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className={workspaceStyles.sectionTitle}>Review bank matching</h3><p className={workspaceStyles.sectionDescription}>Select open invoices or bills for one partner, review the exact amount, then settle through payment approval.</p></div>
      {onFindMatches || onApplyRules ? <div className={workspaceStyles.actions}>
        {onFindMatches ? <Button variant="outline" className={touchButton} disabled={locked || live.status !== "ready"} onClick={() => void find(onFindMatches)}>Refresh suggestions</Button> : null}
        {onApplyRules ? <Button variant="ghost" className={touchButton} disabled={locked || live.status !== "ready"} onClick={() => void find(onApplyRules)}>Find rule suggestions</Button> : null}
      </div> : null}
    </header>
    {operation ? <div role="status" aria-live="polite" className="space-y-3 rounded-xl border bg-muted/30 p-4" data-testid="reconciliation-operation">
      <p className="font-medium">{operation.status === "pending" ? "Confirming the reviewed bank settlement…" : operation.status === "confirmed" ? "Bank settlement confirmed" : operation.status === "awaiting_approval" ? "Payment awaiting approval or settlement completion" : "Previous action is unconfirmed"}</p>
      <p className="text-sm text-muted-foreground">Company #{operation.request.companyId} · Statement #{operation.request.statementId} · Bank line #{operation.request.lineId}. {operation.message ?? (operation.status === "confirmed" ? "The posted payment and selected invoice balances are settled, and the bank line is matched." : "The original selection is preserved. No action will be replayed automatically.")}</p>
      {!scopeMatches ? <p className="text-sm">The active company changed. This recovery still refers only to the original company and line.</p> : null}
      {operation.status === "unknown" ? onCheckStatus ? <Button variant="outline" className={touchButton} disabled={checking} onClick={() => void check()}>{checking ? "Checking original action…" : "Check original action"}</Button> : <p className="text-sm">Exact read-back is unavailable. Refresh the original statement before taking further action; do not resubmit this link.</p> : null}
      {operation.status === "awaiting_approval" ? <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">The bank line remains unmatched until the payment is posted and settlement completes. Review the payment approval, then explicitly complete the original settlement.</p>
        <a className="text-sm text-primary underline" href={`/approvals?model=account_payment&resId=${operation.paymentId}`} target="_blank" rel="noreferrer">Review approval for payment #{operation.paymentId}</a>
        <Button variant="outline" className={touchButton} disabled={busy.current || !scopeMatches || source.state.status !== "ready"} onClick={() => void completeApproved()}>Complete approved settlement</Button>
        {onCheckStatus ? <Button variant="ghost" className={touchButton} disabled={checking} onClick={() => void check()}>Check payment status</Button> : null}
      </div> : null}
      {operation.status === "confirmed" ? <Button variant="outline" className={touchButton} onClick={() => { setOperation(null); setSelection({ key: "", ids: [] }); setSearch("") }}>Review another line</Button> : null}
    </div> : null}
    {source.state.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">Loading the current statement and eligible journal items…</p> : <ModuleDataNotice state={source.state} />}
    {message ? <p role="alert" className="rounded-lg border p-3 text-sm">{message}</p> : null}
    {!operation && projection.status === "blocked" ? <p role="status" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{projection.message}</p> : null}
    {projection.status === "ready" && mayDisplayReview ? <div className="grid min-w-0 gap-4 @min-[56rem]:grid-cols-[minmax(0,1.4fr)_minmax(17rem,1fr)]">
      <div className="min-w-0 space-y-4">
        <section className={cn(workspaceStyles.surface, "min-w-0 p-4")} aria-label="Current bank line">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">1 · Bank line to match</p>
          <h4 className="mt-2 font-semibold">{projection.context.statementLabel}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{projection.context.lineLabel} · Line #{projection.context.lineId}</p>
          <p className="mt-1 text-sm text-muted-foreground">{projection.context.dateLabel ?? "Date unavailable"}{projection.context.partnerLabel ? ` · ${projection.context.partnerLabel}` : ""}</p>
          <p className="mt-3 text-xl font-semibold tabular-nums">{money(projection.context.amount, projection.context)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{projection.context.amount > 0 ? "Money received" : "Money paid out"} · Company #{projection.context.companyId}</p>
        </section>
        <section className={cn(workspaceStyles.surface, "min-w-0 p-4")} aria-label="Eligible journal items">
          <div className="space-y-3"><h4 className={workspaceStyles.sectionTitle}>2 · Select matching records</h4><p className={workspaceStyles.sectionDescription}>Posted, open invoice receivables or bill payables in the same company and base currency. Select one partner and every open item of each chosen invoice. Suggestions require review.</p><Input aria-label="Search matching records" className="min-h-11" value={search} disabled={locked} onChange={(event) => setSearch(event.target.value)} placeholder="Search document, partner, account or description" /></div>
          <p className="my-3 text-xs text-muted-foreground" role="status">{candidates.length} eligible {candidates.length === 1 ? "record" : "records"}{searchValue ? " matching this search" : ""}</p>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto p-0.5">
            {candidates.length ? candidates.map((candidate) => <div key={candidate.id} className={cn("min-w-0 rounded-lg border p-3", selectedIds.includes(candidate.id) && "border-primary/50 bg-primary/5")} data-testid={`reconciliation-candidate-${candidate.id}`}>
              <div className="flex min-w-0 items-start gap-2">
                <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md focus-within:ring-2 focus-within:ring-ring"><input type="checkbox" aria-label={`Select ${candidate.documentLabel}, ${candidate.description}`} className="size-4 accent-primary" checked={selectedIds.includes(candidate.id)} disabled={locked || !canReconcile} onChange={() => toggle(candidate.id)} /></label>
                <div className="min-w-0 flex-1"><a className="inline-flex min-h-11 max-w-full items-center py-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={candidate.href} aria-disabled={operationLocked || undefined} onClick={(event) => { if (operationLocked) event.preventDefault() }}>{candidate.documentLabel}</a><p className="text-sm">{candidate.description}</p>{candidate.partner ? <p className="mt-1 text-xs text-muted-foreground">{candidate.partner}</p> : null}<p className="mt-1 text-xs text-muted-foreground">{candidate.accountLabel} · Item #{candidate.id}</p></div>
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-2"><span className="text-sm font-medium tabular-nums">{money(candidate.amount, projection.context)}</span>{candidate.suggested ? <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Suggested · review required</span> : null}</div>
            </div>) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{searchValue ? "No records match this search. Clear the search to see all eligible records." : "No eligible journal items are available. Check posting, currency and account setup before continuing."}</p>}
          </div>
        </section>
      </div>
      <section className={cn(workspaceStyles.surface, "min-w-0 self-start space-y-4 p-4")} aria-label="Review selected matches">
        <div><h4 className={workspaceStyles.sectionTitle}>3 · Review and confirm</h4><p className={workspaceStyles.sectionDescription}>This posts a bank payment and settles the selected invoices or bills after any required approval. Only exact, complete amounts for one partner are supported.</p></div>
        <p className="text-sm">{review.selected.length} selected {review.selected.length === 1 ? "journal item" : "journal items"}</p>
        {selectedIds.length ? <Button variant="ghost" className={touchButton} disabled={locked} onClick={() => { setSelection({ key: projection.context.key, ids: [] }); setReviewedSignature(null) }}>Clear selection</Button> : null}
        {review.selected.length ? <ul className="space-y-2 text-sm">{review.selected.map((row) => <li key={row.id} className="flex min-w-0 flex-wrap justify-between gap-2"><span>{row.documentLabel} · Item #{row.id}</span><span className="tabular-nums">{money(row.amount, projection.context)}</span></li>)}</ul> : null}
        {review.selected.length !== selectedIds.length ? <p role="alert" className="text-sm text-destructive">A selected item is no longer eligible. Clear it by selecting current records and review again.</p> : null}
        <dl className="space-y-3 border-y py-4 text-sm"><Amount label="Bank amount" value={money(projection.context.amount, projection.context)} /><Amount label="Selected open amount" value={money(review.total, projection.context)} /><Amount label="Difference" value={money(review.difference, projection.context)} /></dl>
        {!review.request && selectedIds.length > 0 ? <p className="text-sm text-muted-foreground">Select all open items of each invoice for one partner. Their total must exactly match the signed bank amount at the currency’s precision.</p> : null}
        {!canReconcile ? <p role="status" className="text-sm text-muted-foreground">You can review this statement, but do not have permission to post payments and settle this bank line.</p> : null}
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-2 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={reviewed} disabled={locked || !review.request || !canReconcile} onChange={(event) => setReviewedSignature(event.target.checked ? signature : null)} /><span>I reviewed the statement, partner, selected invoices and exact amounts. I authorize the payment and settlement, subject to required approval.</span></label>
        <Button className={cn(touchButton, "w-full justify-center")} data-testid="reconciliation-confirm" disabled={locked || !canReconcile || !review.request || !reviewed} onClick={() => void submit()}>Confirm bank settlement</Button>
      </section>
    </div> : null}
    {navigationDialog}
  </section>
}
function Amount({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-full font-medium tabular-nums">{value}</dd></div>
}
