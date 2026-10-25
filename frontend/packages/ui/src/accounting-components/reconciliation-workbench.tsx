"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { bankSettlementAttempt, bankSettlementPendingReversalRequest, bankSettlementRecoveryAllowed, bankSettlementRecoveryRequest, type BankSettlementAttempt, type BankSettlementPhase, type BankSettlementRecoveryAction, type BankSettlementRecoveryRequest } from "@lumiere/erp-shared/bank-settlement-lifecycle"
import { Button } from "../components/button"
import { Input } from "../components/input"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { workspaceStyles } from "../lib/workspace-styles"
import { cn } from "../lib/utils"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"
import { projectReconciliation, reconciliationId, reconciliationLifecycleContext, reconciliationSelection, type ReconciliationContext, type ReconciliationProjection, type ReconciliationRequest, type ReconciliationSource } from "./reconciliation-workbench-model"
import { DatePicker } from "../components/date-picker"

export type ReconciliationOutcome = { status: "awaiting_approval"; paymentId: string } | { status: "confirmed" } | { status: "rejected"; message: string } | { status: "unknown"; message?: string } | { status: "lifecycle"; attempt: BankSettlementAttempt }
export type ReconciliationStatusResult = "confirmed" | "unconfirmed" | { status: "awaiting_approval"; paymentId: string } | { status: "lifecycle"; attempt: BankSettlementAttempt }
export interface ReconciliationWorkbenchProps {
  source: ReconciliationSource
  /** Stable authenticated actor identity; recovery never transfers to a new login. */
  actorKey: string | null
  canReconcile: boolean
  canRecover?: (action: BankSettlementRecoveryAction) => boolean
  onConfirm: (request: ReconciliationRequest) => Promise<ReconciliationOutcome>
  onRecover?: (request: BankSettlementRecoveryRequest) => Promise<ReconciliationOutcome>
  /** Read-only exact-scope recovery; never submits a financial command. */
  onCheckStatus?: (request: ReconciliationRequest, recovery?: BankSettlementRecoveryRequest) => Promise<ReconciliationStatusResult>
  onFindMatches?: (context: ReconciliationContext) => Promise<void>
  onApplyRules?: (context: ReconciliationContext) => Promise<void>
  onOperationLockChange?: (locked: boolean) => void
  createRecoveryKey?: () => string
}
type ReadyProjection = Extract<ReconciliationProjection, { status: "ready" }>
type OperationStatus = "pending" | "unknown" | "confirmed" | "observed" | Exclude<BankSettlementPhase, "settled">
interface ReviewedOperation {
  actorKey: string
  request: ReconciliationRequest
  context: ReconciliationContext
  projection: ReadyProjection | null
  selectedIds: readonly string[]
  status: OperationStatus
  attempt?: BankSettlementAttempt
  recoveryRequest?: BankSettlementRecoveryRequest
  mayRetryRecovery?: boolean
  paymentId?: string
  message?: string
}
function lifecycleOutcome(operation: ReviewedOperation, attempt: BankSettlementAttempt): ReviewedOperation {
  const successor = operation.recoveryRequest?.action === "resubmit" && attempt.previousPaymentId === operation.recoveryRequest.paymentId && attempt.paymentId !== operation.recoveryRequest.paymentId
  return { ...operation, attempt, paymentId: attempt.paymentId, status: attempt.status === "settled" ? "confirmed" : attempt.status, message: undefined, mayRetryRecovery: false,
    ...(successor ? { request: Object.freeze({ ...operation.request, moveLineIds: Object.freeze([...attempt.selectedMoveLineIds]) }), selectedIds: attempt.selectedMoveLineIds, projection: null } : {}),
    ...(attempt.status === "reversal_awaiting_approval" && operation.recoveryRequest?.idempotencyKey !== attempt.recoveryKey
      ? { recoveryRequest: bankSettlementPendingReversalRequest(operation.context, attempt) ?? undefined } : {}) }
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
export function ReconciliationWorkbench({ source, actorKey, canReconcile, canRecover, onConfirm, onRecover, onCheckStatus, onFindMatches, onApplyRules, onOperationLockChange, createRecoveryKey = () => crypto.randomUUID() }: ReconciliationWorkbenchProps) {
  const { t } = useTranslation()
  const text = (key: string, defaultValue: string) => t(`accounting.bankRecovery.${key}`, { defaultValue })
  const live = projectReconciliation(source)
  const liveContext = reconciliationLifecycleContext(source)
  const observedAttempt = bankSettlementAttempt(source.bankLines.find((row) => reconciliationId(row.id) === reconciliationId(source.line?.id))?.metadata)
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] })
  const [reviewedSignature, setReviewedSignature] = useState<string | null>(null)
  const [operation, setOperation] = useState<ReviewedOperation | null>(null)
  const [dismissedAttempt, setDismissedAttempt] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  const [recoveryAction, setRecoveryAction] = useState<BankSettlementRecoveryAction | null>(null)
  const [recoveryReason, setRecoveryReason] = useState("")
  const [recoveryDate, setRecoveryDate] = useState("")
  const [resubmitIds, setResubmitIds] = useState<string[]>([])
  const [recoveryReview, setRecoveryReview] = useState<string | null>(null)
  const operationLocked = operation != null && !["confirmed", "abandoned", "reversed"].includes(operation.status)
  const navigationDialog = useUnsavedChangesGuard(false, operationLocked)
  useEffect(() => { onOperationLockChange?.(operationLocked) }, [operationLocked, onOperationLockChange])
  // React state alone cannot prevent two clicks before the pending render commits.
  const busy = useRef(false)
  const currentActor = useRef(actorKey)
  currentActor.current = actorKey
  const projection = operation?.projection ?? live
  const selectedIds = operation?.selectedIds ?? (projection.status === "ready" && selection.key === projection.context.key ? selection.ids : [])
  const review = reconciliationSelection(projection, selectedIds)
  const signature = projection.status === "ready" ? JSON.stringify([actorKey, projection.context, review.selected]) : ""
  const reviewed = reviewedSignature === signature
  const locked = operation !== null || suggestionBusy
  const scopeMatches = operation === null || (reconciliationId(source.organizationId) === operation.request.organizationId && reconciliationId(source.companyId) === operation.request.companyId)
  const actorMatches = actorKey != null && actorKey !== "" && (operation === null || actorKey === operation.actorKey)
  const mayDisplayReview = source.state.status === "ready" && scopeMatches && actorMatches
  const resubmitReview = recoveryAction === "resubmit" && live.status === "ready" && live.context.key === operation?.context.key
    ? reconciliationSelection(live, resubmitIds) : null
  const recoverySignature = operation && recoveryAction ? JSON.stringify([actorKey, operation.attempt, recoveryAction, recoveryReason, recoveryDate, resubmitReview?.selected]) : ""
  const searchValue = search.trim().toLocaleLowerCase()
  const candidates = projection.status === "ready" ? projection.candidates.filter((row) => [row.documentLabel, row.description, row.partner, row.accountLabel].some((value) => value.toLocaleLowerCase().includes(searchValue))) : []
  // A persisted hint can resume a review, but must be checked against canonical
  // financial records before it becomes a confirmed result or an enabled action.
  const observedKey = observedAttempt ? `${observedAttempt.attemptId}:${observedAttempt.status}` : null
  useEffect(() => {
    if (operation || !actorKey || !liveContext || !observedAttempt || observedAttempt.attemptId === dismissedAttempt || ["abandoned", "reversed"].includes(observedAttempt.status)) return
    const request: ReconciliationRequest = Object.freeze({ organizationId: liveContext.organizationId, companyId: liveContext.companyId,
      statementId: liveContext.statementId, lineId: liveContext.lineId, moveLineIds: Object.freeze([...observedAttempt.selectedMoveLineIds]), amountResidual: 0 })
    setOperation({ actorKey, request, context: liveContext, projection: null, selectedIds: request.moveLineIds, status: "observed", attempt: observedAttempt, paymentId: observedAttempt.paymentId })
  }, [operation, actorKey, liveContext?.key, observedKey, dismissedAttempt])
  const toggle = (id: string) => {
    if (locked || !canReconcile || !actorMatches || live.status !== "ready") return
    setReviewedSignature(null)
    setSelection({ key: live.context.key, ids: selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id] })
  }
  const applyResult = (captured: ReviewedOperation, result: ReconciliationOutcome) => {
    if (currentActor.current !== captured.actorKey) {
      setOperation({ ...captured, status: "unknown", message: text("actorChanged", "The signed-in user changed. Return to the original user and check this action.") })
    } else if (result.status === "lifecycle") setOperation(lifecycleOutcome(captured, result.attempt))
    else if (result.status === "rejected" && !captured.recoveryRequest) { setOperation(null); setMessage(result.message); onOperationLockChange?.(false) }
    else if (result.status === "rejected") setOperation(captured.status === "unknown" ? { ...captured, status: "unknown", message: result.message }
      : { ...captured, recoveryRequest: undefined, mayRetryRecovery: false, message: result.message })
    else setOperation({ ...captured, status: result.status, ...(result.status === "unknown" ? { message: result.message } : { message: undefined }), ...(result.status === "awaiting_approval" ? { paymentId: result.paymentId } : {}) })
  }
  const submit = async () => {
    if (busy.current || operation || !actorKey || !canReconcile || live.status !== "ready" || !reviewed || !review.request || !mayDisplayReview) return
    const request: ReconciliationRequest = Object.freeze({ ...review.request, moveLineIds: Object.freeze([...review.request.moveLineIds]) })
    const captured: ReviewedOperation = { actorKey, request, context: live.context, projection: live, selectedIds: [...selectedIds], status: "pending" }
    busy.current = true
    onOperationLockChange?.(true)
    setOperation(captured)
    setMessage(null)
    setReviewedSignature(null)
    try { applyResult(captured, await onConfirm(request)) }
    catch { setOperation({ ...captured, status: "unknown", message: "The result could not be confirmed. Check the original action before continuing." }) }
    finally { busy.current = false }
  }
  const check = async () => {
    if (busy.current || !actorMatches || !operation || operation.status === "pending" || !onCheckStatus) return
    busy.current = true
    setChecking(true)
    try {
      const result = await onCheckStatus(operation.request, operation.recoveryRequest)
      if (currentActor.current !== operation.actorKey) return
      if (typeof result === "object" && result.status === "lifecycle") {
        setOperation(lifecycleOutcome(operation, result.attempt))
        setRecoveryAction(null); setRecoveryReview(null)
      } else setOperation({ ...operation, status: typeof result === "object" ? "awaiting_approval" : result === "confirmed" ? "confirmed" : "unknown", ...(typeof result === "object" ? { paymentId: result.paymentId } : {}), message: result === "unconfirmed" ? "The original action is still unconfirmed. Nothing has been resubmitted." : undefined })
    } catch { setOperation({ ...operation, message: "The original action could not be checked. Keep this review and check again when access returns." }) }
    finally { busy.current = false; setChecking(false) }
  }
  const completeApproved = async () => {
    if (busy.current || !actorMatches || !canReconcile || !operation || !["awaiting_approval", "payment_posted"].includes(operation.status) || !scopeMatches || source.state.status !== "ready") return
    const captured = operation
    busy.current = true
    setOperation({ ...captured, status: "pending" })
    try { applyResult(captured, await onConfirm(captured.request)) }
    catch { setOperation({ ...captured, status: "unknown", message: "The completion result could not be confirmed. Check the original action before trying again." }) }
    finally { busy.current = false }
  }
  const recover = async (request: BankSettlementRecoveryRequest) => {
    if (busy.current || !operation || !actorMatches || !scopeMatches || source.state.status !== "ready" || !onRecover || !canRecover?.(request.action)) return
    const captured = { ...operation, recoveryRequest: request, mayRetryRecovery: true }
    busy.current = true
    onOperationLockChange?.(true)
    setRecoveryAction(null); setRecoveryReview(null)
    setOperation({ ...captured, status: "pending" })
    try { applyResult(captured, await onRecover(request)) }
    catch { setOperation({ ...captured, status: "unknown", message: text("unknownRecovery", "The recovery result is unconfirmed. Check the original action or retry its exact saved request.") }) }
    finally { busy.current = false }
  }
  const submitRecovery = () => {
    if (!operation?.attempt || !recoveryAction || recoveryReview !== recoverySignature || !scopeMatches || !actorMatches) return
    if (recoveryAction === "resubmit" && !resubmitReview?.request) return
    const request = bankSettlementRecoveryRequest(operation.context, operation.attempt, { action: recoveryAction, reason: recoveryReason, date: recoveryDate, idempotencyKey: createRecoveryKey(),
      ...(recoveryAction === "resubmit" ? { moveLineIds: resubmitReview!.request!.moveLineIds } : {}) })
    if (request) void recover(request)
  }
  const clearOperation = () => {
    if (operation?.attempt) setDismissedAttempt(operation.attempt.attemptId)
    setOperation(null); setSelection({ key: "", ids: [] }); setSearch(""); setRecoveryAction(null); setRecoveryReview(null)
  }
  const find = async (callback: ((context: ReconciliationContext) => Promise<void>) | undefined) => {
    if (busy.current || !actorMatches || locked || live.status !== "ready" || !callback) return
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
      <p className="font-medium">{operation.status === "pending" ? operation.recoveryRequest ? text("pendingRecovery", "Confirming the reviewed settlement recovery…") : "Confirming the reviewed bank settlement…"
        : operation.status === "confirmed" ? "Bank settlement confirmed"
        : operation.status === "awaiting_approval" ? "Payment awaiting approval or settlement completion"
        : operation.status === "payment_posted" ? text("paymentPosted", "Approved payment posted; settlement completion requires review")
        : operation.status === "observed" ? text("checkSaved", "Check the saved settlement before continuing")
        : operation.status === "abandoned" ? text("abandoned", "Unposted settlement draft abandoned")
        : operation.status === "reversed" ? text("reversed", "Settlement reversal confirmed")
        : operation.status === "reversal_awaiting_approval" ? text("reversalApproval", "Settlement reversal awaiting approval")
        : operation.status.startsWith("reversal_") ? text("reversalClosed", "The reversal approval is closed; the posted settlement remains unchanged")
        : operation.status.startsWith("approval_") ? text("approvalClosed", "The payment approval is closed; the bank line remains unmatched")
        : "Previous action is unconfirmed"}</p>
      <p className="text-sm text-muted-foreground">Company #{operation.request.companyId} · Statement #{operation.request.statementId} · Bank line #{operation.request.lineId}. {operation.message ?? (operation.status === "confirmed" ? "The posted payment and selected invoice balances are settled, and the bank line is matched."
        : operation.status === "reversed" ? operation.attempt?.allocationApplied ? text("restored", "The compensating entry is posted, this settlement’s invoice balances are restored, and the statement is open with an unmatched bank line.") : text("unallocatedReversed", "The unallocated payment has a posted compensating entry. The statement is open and the bank line is unmatched.")
        : operation.status === "abandoned" ? text("retired", "The unposted payment is retired and the original invoice balances are unchanged. Review a fresh settlement when ready.")
        : "The original selection is preserved. No action will be replayed automatically.")}</p>
      {operation.attempt && actorMatches ? <p className="text-sm">{text("originalPayment", "Original payment")} #{operation.attempt.paymentId} · {text("selectedItems", "Selected journal items")}: {operation.attempt.selectedMoveLineIds.map((id) => `#${id}`).join(", ")}</p> : null}
      {!scopeMatches ? <p className="text-sm">The active company changed. This recovery still refers only to the original company and line.</p> : null}
      {!actorMatches ? <p className="text-sm">{text("originalUser", "Return to the original signed-in user to recover this action.")}</p> : null}
      {operation.status !== "pending" && !["confirmed", "abandoned", "reversed"].includes(operation.status) ? onCheckStatus ? <Button variant="outline" className={touchButton} disabled={checking || !actorMatches} onClick={() => void check()}>{checking ? "Checking original action…" : operation.status === "awaiting_approval" ? "Check payment status" : operation.status === "observed" ? text("checkSettlement", "Check settlement status") : "Check original action"}</Button> : <p className="text-sm">Exact read-back is unavailable. Refresh the original statement before taking further action; do not resubmit this link.</p> : null}
      {operation.status === "awaiting_approval" ? <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">The bank line remains unmatched until the payment is posted and settlement completes. Review the payment approval, then explicitly complete the original settlement.</p>
        {actorMatches ? <a className="text-sm text-primary underline" href={`/approvals?model=account_payment&resId=${operation.paymentId}`} target="_blank" rel="noreferrer">Review approval for payment #{operation.paymentId}</a> : null}
        {!operation.attempt ? <Button variant="outline" className={touchButton} disabled={busy.current || !actorMatches || !canReconcile || !scopeMatches || source.state.status !== "ready"} onClick={() => void completeApproved()}>Complete approved settlement</Button> : null}
      </div> : null}
      {operation.status === "payment_posted" ? <Button variant="outline" className={touchButton} disabled={busy.current || !actorMatches || !canReconcile || !scopeMatches || source.state.status !== "ready"} onClick={() => void completeApproved()}>Complete approved settlement</Button> : null}
      {operation.status === "unknown" && operation.mayRetryRecovery && operation.recoveryRequest && onRecover ? <Button variant="outline" className={touchButton} disabled={busy.current || !actorMatches || !scopeMatches || source.state.status !== "ready" || !canRecover?.(operation.recoveryRequest.action)} onClick={() => void recover(operation.recoveryRequest!)}>{text("retryOriginal", "Retry original recovery")}</Button> : null}
      {operation.status === "reversal_awaiting_approval" && actorMatches ? <div className="space-y-3">
        <p className="text-sm">{text("reversalUnchanged", "The original posted payment and bank allocation stay unchanged while reversal approval is pending.")}</p>
        {operation.attempt?.reversalRequestId ? <a className="inline-flex min-h-11 items-center text-sm text-primary underline" href={`/approvals?model=account_payment&resId=${operation.attempt.paymentId}`} target="_blank" rel="noreferrer">{text("reviewReversalApproval", "Review reversal approval")} #{operation.attempt.reversalRequestId}</a> : null}
        {operation.recoveryRequest ? <>
          <p className="text-sm">{text("reviewedReason", "Reviewed reason")}: {operation.recoveryRequest.reason} · {text("reversalDate", "Reversal date")}: {new Date(Number(BigInt(operation.recoveryRequest.dateMicros!) / 1000n)).toISOString().slice(0, 10)}</p>
        </> : <p className="text-sm">{text("missingReversal", "The original reversal payload is unavailable. Keep this review and check the saved request; do not create a replacement while approval is open.")}</p>}
      </div> : null}
      {operation.attempt && operation.status !== "observed" && operation.status !== "pending" && operation.status !== "unknown" && onRecover && actorMatches ? <div className="flex flex-wrap gap-2">
        {(["abandon", "resubmit", "reverse"] as const).filter((action) => bankSettlementRecoveryAllowed(operation.attempt!, action)).map((action) => <Button key={action} variant="outline" className={touchButton} disabled={!scopeMatches || source.state.status !== "ready" || !canRecover?.(action)} onClick={() => { setRecoveryAction(action); setRecoveryReason(""); setRecoveryDate(""); setRecoveryReview(null); setResubmitIds(action === "resubmit" && reconciliationSelection(live, operation.attempt!.selectedMoveLineIds).request ? [...operation.attempt!.selectedMoveLineIds] : []) }}>{action === "abandon" ? text("abandon", "Abandon unposted draft") : action === "resubmit" ? text("resubmit", "Resubmit for approval") : text("reverse", "Reverse settlement")}</Button>)}
      </div> : null}
      {recoveryAction && operation.attempt && actorMatches ? <section className="min-w-0 space-y-3 rounded-lg border bg-background p-3" aria-label={text("reviewRecovery", "Review settlement recovery")}>
        <p className="text-sm">{recoveryAction === "abandon" ? text("abandonEffect", "Retire this closed, unposted payment draft. The invoice balances stay unchanged and a fresh settlement can be reviewed afterwards.") : recoveryAction === "resubmit" ? text("resubmitEffect", "Retire the closed draft and submit one new payment approval for the freshly reviewed invoices. The bank line remains unmatched until the approved settlement completes.") : text("reverseEffect", "Post a compensating journal entry and restore only the balances allocated by this bank settlement. Earlier payments remain applied.")}</p>
        {recoveryAction === "resubmit" ? <section className="space-y-3" aria-label={text("selectResubmission", "Select obligations for resubmission")}>
          {mayDisplayReview && live.status === "ready" ? <>
            <div className="max-h-64 space-y-2 overflow-y-auto">{live.candidates.map((candidate) => <label key={candidate.id} className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" aria-label={`${text("selectResubmissionItem", "Resubmit invoice item")} ${candidate.documentLabel}, ${candidate.description}`} checked={resubmitIds.includes(candidate.id)} onChange={(event) => { setResubmitIds(event.target.checked ? [...resubmitIds, candidate.id] : resubmitIds.filter((id) => id !== candidate.id)); setRecoveryReview(null) }} /><span className="min-w-0">{candidate.documentLabel} · {candidate.description}<span className="block tabular-nums">{money(candidate.amount, live.context)}</span></span></label>)}</div>
            <p className="text-sm tabular-nums">{text("resubmitTotal", "Selected open amount")}: {money(resubmitReview?.total ?? null, live.context)} · {text("resubmitDifference", "Difference")}: {money(resubmitReview?.difference ?? null, live.context)}</p>
            {!resubmitReview?.request ? <p className="text-sm">{text("resubmitExact", "Select every current open item of each chosen invoice for one partner. The total must exactly match the original bank amount.")}</p> : null}
          </> : <p className="text-sm">{text("resubmitUnavailable", "Current eligible invoice records are unavailable. Refresh them before reviewing a resubmission.")}</p>}
        </section> : null}
        <label className="block space-y-2 text-sm"><span>{text("reason", "Reason for recovery")}</span><Input aria-label={text("reason", "Reason for recovery")} value={recoveryReason} maxLength={2000} disabled={!scopeMatches || source.state.status !== "ready"} onChange={(event) => { setRecoveryReason(event.target.value); setRecoveryReview(null) }} /></label>
        {recoveryAction === "reverse" ? <label className="block space-y-2 text-sm"><span>{text("reversalDate", "Reversal date")}</span><DatePicker aria-label={text("reversalDate", "Reversal date")} value={recoveryDate} disabled={!scopeMatches || source.state.status !== "ready"} onChange={(value) => { setRecoveryDate(value); setRecoveryReview(null) }} /></label> : null}
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={recoveryReview === recoverySignature} disabled={!scopeMatches || source.state.status !== "ready" || !canRecover?.(recoveryAction)} onChange={(event) => setRecoveryReview(event.target.checked ? recoverySignature : null)} /><span>{text("reviewAuthorization", "I reviewed the original payment, selected invoices, reason and financial effect of this recovery.")}</span></label>
        <div className="flex flex-wrap gap-2"><Button className={touchButton} disabled={recoveryReview !== recoverySignature || recoveryReason.trim().length < 3 || (recoveryAction === "reverse" && !/^\d{4}-\d{2}-\d{2}$/.test(recoveryDate)) || (recoveryAction === "resubmit" && !resubmitReview?.request) || !scopeMatches || source.state.status !== "ready" || !canRecover?.(recoveryAction)} onClick={submitRecovery}>{text("confirmRecovery", "Confirm reviewed recovery")}</Button><Button variant="ghost" className={touchButton} onClick={() => { setRecoveryAction(null); setRecoveryReview(null) }}>{text("cancelReview", "Cancel recovery review")}</Button></div>
      </section> : null}
      {["confirmed", "abandoned", "reversed"].includes(operation.status) ? <Button variant="outline" className={touchButton} onClick={clearOperation}>Review another line</Button> : null}
    </div> : null}
    {source.state.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">Loading the current statement and eligible journal items…</p> : <ModuleDataNotice state={source.state} />}
    {message ? <p role="alert" className="rounded-lg border p-3 text-sm">{message}</p> : null}
    {!operation && projection.status === "blocked" ? <p role="status" className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{projection.message}</p> : null}
    {projection.status === "ready" && mayDisplayReview && (!operation || operation.projection != null) ? <div className="grid min-w-0 gap-4 @min-[56rem]:grid-cols-[minmax(0,1.4fr)_minmax(17rem,1fr)]">
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
