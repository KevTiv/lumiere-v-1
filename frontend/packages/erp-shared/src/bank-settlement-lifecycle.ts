import { parseStrictU64 } from "./u64"

export const BANK_SETTLEMENT_PHASES = [
  "awaiting_approval", "approval_rejected", "approval_invalidated", "approval_cancelled",
  "payment_posted", "settled", "abandoned", "reversal_awaiting_approval", "reversal_rejected",
  "reversal_invalidated", "reversal_cancelled", "reversed",
] as const
export type BankSettlementPhase = typeof BANK_SETTLEMENT_PHASES[number]
export type BankSettlementRecoveryAction = "abandon" | "resubmit" | "reverse"
export interface BankSettlementAttempt {
  readonly attemptId: string
  readonly generation: string
  readonly paymentId: string
  readonly selectedMoveLineIds: readonly string[]
  readonly selectedResiduals?: readonly { readonly lineId: string; readonly moveId?: string; readonly residual: number; readonly residualCurrency?: number }[]
  readonly status: BankSettlementPhase
  readonly allocationApplied?: boolean
  readonly paymentMoveId?: string
  readonly reversalRequestId?: string
  readonly reversalDateMicros?: string
  readonly reversalReason?: string
  readonly reversalMoveId?: string
  readonly recoveryAction?: BankSettlementRecoveryAction
  readonly recoveryKey?: string
  readonly recoveryReason?: string
  readonly previousPaymentId?: string
}
export interface BankSettlementRecoveryRequest {
  readonly organizationId: string
  readonly companyId: string
  readonly statementId: string
  readonly lineId: string
  readonly attemptId: string
  readonly paymentId: string
  readonly action: BankSettlementRecoveryAction
  readonly idempotencyKey: string
  readonly reason: string
  readonly moveLineIds: readonly string[]
  readonly dateMicros?: string
}

/** Untrusted metadata fields are validated individually before becoming an attempt. */
interface BankSettlementMetadata {
  bankSettlement?: unknown
  attemptId?: unknown
  generation?: unknown
  paymentId?: unknown
  selectedMoveLineIds?: unknown
  selectedResiduals?: unknown
  status?: unknown
  allocationApplied?: unknown
  paymentMoveId?: unknown
  reversalRequestId?: unknown
  reversalDateMicros?: unknown
  reversalReason?: unknown
  reversalMoveId?: unknown
  recoveryAction?: unknown
  recoveryKey?: unknown
  recoveryReason?: unknown
  previousPaymentId?: unknown
  lineId?: unknown
  moveId?: unknown
  residual?: unknown
  residualCurrency?: unknown
}
const record = (value: unknown): BankSettlementMetadata | null => value != null && typeof value === "object" && !Array.isArray(value) ? value as BankSettlementMetadata : null
const exactId = (value: unknown): string | null => { const id = parseStrictU64(value); return id != null && id > 0n ? String(id) : null }
const boundedText = (value: unknown, maximum = 256): string | null => typeof value === "string" && value.trim() !== "" && value.length <= maximum ? value : null
const finiteAmount = (value: unknown): number | null => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

export function hasBankSettlementAttempt(metadata: unknown): boolean {
  if (typeof metadata === "string") { try { metadata = JSON.parse(metadata) } catch { return false } }
  return record(metadata)?.bankSettlement != null
}

/** Public metadata is a lifecycle hint; financial success still requires canonical rows. */
export function bankSettlementAttempt(metadata: unknown): BankSettlementAttempt | null {
  if (typeof metadata === "string") { try { metadata = JSON.parse(metadata) } catch { return null } }
  const value = record(record(metadata)?.bankSettlement)
  if (!value) return null
  const attemptId = boundedText(value.attemptId)
  const generation = typeof value.generation === "string" && /^(0|[1-9]\d*)$/.test(value.generation) ? value.generation : null
  const paymentId = exactId(value.paymentId)
  const selectedMoveLineIds = Array.isArray(value.selectedMoveLineIds) ? value.selectedMoveLineIds.map(exactId) : []
  if (!attemptId || !generation || !paymentId || !selectedMoveLineIds.length || selectedMoveLineIds.some((id) => !id)
    || new Set(selectedMoveLineIds).size !== selectedMoveLineIds.length
    || !BANK_SETTLEMENT_PHASES.includes(value.status as BankSettlementPhase)) return null
  const result: BankSettlementAttempt = {
    attemptId, generation, paymentId, selectedMoveLineIds: Object.freeze(selectedMoveLineIds as string[]), status: value.status as BankSettlementPhase,
  }
  if (value.allocationApplied != null) {
    if (typeof value.allocationApplied !== "boolean") return null
    Object.assign(result, { allocationApplied: value.allocationApplied })
  }
  const optionalIds = ["paymentMoveId", "reversalRequestId", "reversalMoveId", "previousPaymentId"] as const
  for (const key of optionalIds) {
    if (value[key] == null) continue
    const id = exactId(value[key])
    if (!id) return null
    Object.assign(result, { [key]: id })
  }
  if (value.selectedResiduals != null) {
    if (!Array.isArray(value.selectedResiduals)) return null
    const residuals = value.selectedResiduals.map((entry) => {
      const row = record(entry), lineId = exactId(row?.lineId), residual = finiteAmount(row?.residual)
      const moveId = row?.moveId == null ? undefined : exactId(row.moveId)
      const residualCurrency = row?.residualCurrency == null ? undefined : finiteAmount(row.residualCurrency)
      return lineId && residual != null && residual !== 0 && moveId !== null && residualCurrency !== null
        ? { lineId, residual, ...(moveId ? { moveId } : {}), ...(residualCurrency != null ? { residualCurrency } : {}) } : null
    })
    if (residuals.some((entry) => entry == null) || residuals.length !== selectedMoveLineIds.length
      || new Set(residuals.map((entry) => entry!.lineId)).size !== residuals.length
      || residuals.some((entry) => !selectedMoveLineIds.includes(entry!.lineId))) return null
    Object.assign(result, { selectedResiduals: Object.freeze(residuals.map((entry) => Object.freeze(entry!))) })
  }
  if (value.reversalDateMicros != null) {
    if (typeof value.reversalDateMicros !== "string" || !/^-?\d+$/.test(value.reversalDateMicros)) return null
    Object.assign(result, { reversalDateMicros: value.reversalDateMicros })
  }
  if (value.recoveryAction != null) {
    if (!["abandon", "resubmit", "reverse"].includes(String(value.recoveryAction))) return null
    Object.assign(result, { recoveryAction: value.recoveryAction })
  }
  for (const key of ["recoveryKey", "recoveryReason", "reversalReason"] as const) {
    if (value[key] == null) continue
    const content = boundedText(value[key], key === "recoveryKey" ? 256 : 2000)
    if (!content) return null
    Object.assign(result, { [key]: content })
  }
  return Object.freeze(result)
}

export function bankSettlementRecoveryAllowed(attempt: BankSettlementAttempt, action: BankSettlementRecoveryAction): boolean {
  const closedDraft = ["approval_rejected", "approval_invalidated", "approval_cancelled"].includes(attempt.status)
  return action === "abandon" || action === "resubmit" ? closedDraft
    : ["payment_posted", "settled", "reversal_rejected", "reversal_invalidated", "reversal_cancelled"].includes(attempt.status)
}

/** Capture the reviewed payload once. Uncertain results must reuse this exact object. */
export function bankSettlementRecoveryRequest(
  context: { organizationId: unknown; companyId: unknown; statementId: unknown; lineId: unknown },
  attempt: BankSettlementAttempt,
  review: { action: BankSettlementRecoveryAction; reason: string; idempotencyKey: string; date?: string; moveLineIds?: readonly string[] },
): BankSettlementRecoveryRequest | null {
  if (!bankSettlementRecoveryAllowed(attempt, review.action)) return null
  const organizationId = exactId(context.organizationId), companyId = exactId(context.companyId), statementId = exactId(context.statementId), lineId = exactId(context.lineId)
  const reason = review.reason.trim(), idempotencyKey = boundedText(review.idempotencyKey)
  if (!organizationId || !companyId || !statementId || !lineId || reason.length < 3 || reason.length > 2000 || !idempotencyKey) return null
  const moveLineIds = review.action === "resubmit" && review.moveLineIds ? review.moveLineIds.map(exactId) : [...attempt.selectedMoveLineIds]
  if (!moveLineIds.length || moveLineIds.some((value) => !value) || new Set(moveLineIds).size !== moveLineIds.length) return null
  let dateMicros: string | undefined
  if (review.action === "reverse") {
    if (!review.date || !/^\d{4}-\d{2}-\d{2}$/.test(review.date)) return null
    const date = new Date(`${review.date}T00:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== review.date) return null
    dateMicros = String(BigInt(date.getTime()) * 1000n)
  }
  return Object.freeze({ organizationId, companyId, statementId, lineId, attemptId: attempt.attemptId, paymentId: attempt.paymentId,
    action: review.action, idempotencyKey, reason, moveLineIds: Object.freeze(moveLineIds as string[]), ...(dateMicros ? { dateMicros } : {}) })
}

export function bankSettlementRecoveryCorrelates(attempt: BankSettlementAttempt, request: BankSettlementRecoveryRequest): boolean {
  return attempt.recoveryAction === request.action && attempt.recoveryKey === request.idempotencyKey
    && (request.action === "reverse" || attempt.recoveryReason === request.reason)
    && (request.action === "resubmit" ? attempt.previousPaymentId === request.paymentId && attempt.paymentId !== request.paymentId && attempt.attemptId !== request.attemptId : attempt.paymentId === request.paymentId && attempt.attemptId === request.attemptId)
    && (request.action !== "reverse" || attempt.reversalDateMicros === request.dateMicros && attempt.reversalReason === request.reason)
    && attempt.selectedMoveLineIds.length === request.moveLineIds.length
    && attempt.selectedMoveLineIds.every((id) => request.moveLineIds.includes(id))
}

/** Reconstruct persisted reversal identity for read-only canonical status checks. */
export function bankSettlementPendingReversalRequest(
  context: { organizationId: unknown; companyId: unknown; statementId: unknown; lineId: unknown },
  attempt: BankSettlementAttempt,
): BankSettlementRecoveryRequest | null {
  if (attempt.status !== "reversal_awaiting_approval" || attempt.recoveryAction !== "reverse" || !attempt.recoveryKey || !attempt.reversalDateMicros) return null
  const reason = attempt.reversalReason ?? attempt.recoveryReason
  if (!reason) return null
  const date = new Date(Number(BigInt(attempt.reversalDateMicros) / 1000n))
  if (!Number.isFinite(date.getTime())) return null
  const request = bankSettlementRecoveryRequest(context, { ...attempt, status: "settled" }, { action: "reverse", idempotencyKey: attempt.recoveryKey, reason, date: date.toISOString().slice(0, 10) })
  return request?.dateMicros === attempt.reversalDateMicros ? request : null
}
