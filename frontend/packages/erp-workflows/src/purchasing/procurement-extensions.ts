/**
 * Procurement lifecycles around the core P2P path: supplier intake (onboarding), landed costs,
 * purchase returns and blanket-order releases.
 *
 * Presentation gates only; the reducers re-validate state, permission and scope
 * (mirrors `vendor_management.rs`, `landed_costs.rs`, `purchase_returns.rs`, `procurement_advanced.rs`).
 */

import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import { recordAction, type ExecuteAction, type WorkflowAction } from "../core/action"
import { recordRef } from "../core/record-ref"
import { rowId, variantTag } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"
import { invoiceWorkflow } from "../accounting/invoice-to-payment"
import { pickingWorkflow } from "../inventory/fulfillment"
import { purchaseOrderWorkflow } from "./procure-to-pay"

export const supplierIntakeWorkflow = defineWorkflow({
  id: "purchasing.supplier-intake",
  resource: "supplier_intake_request",
  module: "purchasing",
})

export const landedCostWorkflow = defineWorkflow({
  id: "purchasing.landed-cost",
  resource: "stock_landed_cost",
  module: "purchasing",
})

export const purchaseReturnWorkflow = defineWorkflow({
  id: "purchasing.return",
  resource: "purchase_return",
  module: "purchasing",
})

export const SUPPLIER_INTAKE_TRANSITION_AFFECTS = ["supplier-intakes", "contacts"] as const
export const LANDED_COST_DRAFT_AFFECTS = ["landed-costs", "landed-cost-lines", "purchase-orders"] as const
/** Posting books the landed-cost journal entry. */
export const POST_LANDED_COST_AFFECTS = [...LANDED_COST_DRAFT_AFFECTS, "account-moves", "account-move-lines"] as const
/** Applying revalues the received stock. */
export const APPLY_LANDED_COST_AFFECTS = [...LANDED_COST_DRAFT_AFFECTS, "stock-quants"] as const
/** Confirming a return creates the outgoing return picking. */
export const CONFIRM_PURCHASE_RETURN_AFFECTS = [
  "purchase-returns",
  "purchase-return-lines",
  "stock-pickings",
  "stock-moves",
] as const
export const VENDOR_CREDIT_FROM_RETURN_AFFECTS = ["purchase-returns", "account-moves", "account-move-lines"] as const
export const RELEASE_BLANKET_AFFECTS = [
  "purchase-orders",
  "purchase-orders-to-approve",
  "purchase-order-lines",
  "purchase-blanket-orders",
  "purchase-blanket-order-lines",
  "purchase-blanket-releases",
] as const

const stateOf = (row: RowValueMap) => variantTag(firstNonNullKey(row, "state"))
const isOneOf = (row: RowValueMap, ...states: string[]) => states.includes(stateOf(row))
const hasValue = (row: RowValueMap, ...keys: string[]) => firstNonNullKey(row, ...keys) != null

// ── Supplier intake: Draft/Submitted → UnderReview → Approved | Rejected | OnHold ──

export const isIntakeReviewable = (row: RowValueMap) => isOneOf(row, "Submitted", "OnHold")
export const isIntakeApprovable = (row: RowValueMap) => isOneOf(row, "Submitted", "UnderReview")
export const isIntakeHoldable = isIntakeApprovable
export const isIntakeRejectable = (row: RowValueMap) => !isOneOf(row, "Approved", "Rejected", "Onboarded")

export interface ReviewSupplierIntakeInput {
  intakeId: string
  notes?: string
}

export interface ApproveSupplierIntakeInput {
  intakeId: string
  /** The vendor partner the intake becomes; the reducer rejects a non-vendor. */
  partnerId: string
}

export interface SupplierIntakeReasonInput {
  intakeId: string
  reason: string
}

/** Row dispatch reviews without notes; the review form dispatches its collected notes through the same `execute`. */
export function reviewSupplierIntakeAction(options: {
  label: string
  execute: ExecuteAction<ReviewSupplierIntakeInput>
}): WorkflowAction<RowValueMap, ReviewSupplierIntakeInput> {
  return {
    id: "purchasing.supplier-intake.review",
    label: options.label,
    kind: "immediate",
    canPresent: isIntakeReviewable,
    prepare: (row) => ({ intakeId: rowId(row) }),
    execute: options.execute,
  }
}

export function approveSupplierIntakeAction(options: {
  label: string
  execute: ExecuteAction<ApproveSupplierIntakeInput>
}): WorkflowAction<RowValueMap, ApproveSupplierIntakeInput> {
  return {
    id: "purchasing.supplier-intake.approve",
    label: options.label,
    kind: "immediate",
    canPresent: isIntakeApprovable,
    prepare: (row) => ({
      intakeId: rowId(row),
      partnerId: String(firstNonNullKey(row, "partnerId", "partner_id") ?? ""),
    }),
    execute: options.execute,
  }
}

/** Hold and reject carry a reason; row dispatch supplies the surface's default, callers with a form pass their own. */
function reasonAction(
  id: string,
  kind: WorkflowAction<RowValueMap, SupplierIntakeReasonInput>["kind"],
  canPresent: (row: RowValueMap) => boolean,
  options: { label: string; defaultReason: string; execute: ExecuteAction<SupplierIntakeReasonInput> },
): WorkflowAction<RowValueMap, SupplierIntakeReasonInput> {
  return {
    id,
    label: options.label,
    kind,
    canPresent,
    prepare: (row) => ({ intakeId: rowId(row), reason: options.defaultReason }),
    execute: options.execute,
  }
}

type ReasonOptions = Parameters<typeof reasonAction>[3]

export const holdSupplierIntakeAction = (o: ReasonOptions) =>
  reasonAction("purchasing.supplier-intake.hold", "immediate", isIntakeHoldable, o)
export const rejectSupplierIntakeAction = (o: ReasonOptions) =>
  reasonAction("purchasing.supplier-intake.reject", "destructive", isIntakeRejectable, o)

// ── Landed cost: Draft → Posted (applied to stock), Cancelled ──

export const isLandedCostDraft = (row: RowValueMap) => isOneOf(row, "Draft")
export const isLandedCostApplicable = (row: RowValueMap) => isOneOf(row, "Posted")

type RecordActionOptions = { label: string; execute: ExecuteAction<string> }

export const computeLandedCostAction = (o: RecordActionOptions) =>
  recordAction("purchasing.landed-cost.compute", "immediate", isLandedCostDraft, o)
export const postLandedCostAction = (o: RecordActionOptions) =>
  recordAction("purchasing.landed-cost.post", "immediate", isLandedCostDraft, o)
export const applyLandedCostAction = (o: RecordActionOptions) =>
  recordAction("purchasing.landed-cost.apply", "immediate", isLandedCostApplicable, o)
export const cancelLandedCostAction = (o: RecordActionOptions) =>
  recordAction("purchasing.landed-cost.cancel", "destructive", isLandedCostDraft, o)

// ── Purchase return: draft → confirmed (return picking) → vendor credit ──

/** Purchase return states are plain lowercase strings (not enums). */
const returnState = (row: RowValueMap) => String(firstNonNullKey(row, "state") ?? "").toLowerCase()

export const isPurchaseReturnConfirmable = (row: RowValueMap) => returnState(row) === "draft"
export const isPurchaseReturnCreditable = (row: RowValueMap) =>
  returnState(row) === "confirmed" && !hasValue(row, "creditMoveId", "credit_move_id")

export const confirmPurchaseReturnAction = (o: RecordActionOptions) =>
  recordAction("purchasing.return.confirm", "immediate", isPurchaseReturnConfirmable, o)

export interface CreateVendorCreditInput<TParams> {
  purchaseReturnId: string
  params: TParams
}

/** Form-backed: the surface collects journal/accounts, then dispatches the collected params. */
export function createVendorCreditFromReturnAction<TParams>(options: {
  label: string
  execute: ExecuteAction<CreateVendorCreditInput<TParams>>
}): WorkflowAction<RowValueMap, CreateVendorCreditInput<TParams>> {
  return {
    id: "purchasing.return.create-vendor-credit",
    label: options.label,
    kind: "form",
    canPresent: isPurchaseReturnCreditable,
    execute: options.execute,
  }
}

/** A confirmed return produces its outgoing picking: open it in Inventory, where the goods are shipped back. */
export function observeConfirmedPurchaseReturn(
  returnId: string,
  returns: readonly RowValueMap[],
): ObservedTransition {
  const picking = firstNonNullKey(returns.find((row) => rowId(row) === returnId) ?? {}, "pickingId", "picking_id")
  if (picking == null) return {}
  const ref = recordRef(pickingWorkflow.resource, picking as string | number | bigint, pickingWorkflow.module, purchaseReturnWorkflow.module)
  return { outcome: "applied", createdRecords: [ref], next: ref }
}

/** The vendor credit is a draft refund move: open it in Accounting, where it is posted. */
export function observeReturnVendorCredit(returnId: string, returns: readonly RowValueMap[]): ObservedTransition {
  const move = firstNonNullKey(returns.find((row) => rowId(row) === returnId) ?? {}, "creditMoveId", "credit_move_id")
  if (move == null) return {}
  const ref = recordRef(invoiceWorkflow.resource, move as string | number | bigint, invoiceWorkflow.module, purchaseReturnWorkflow.module)
  return { outcome: "applied", createdRecords: [ref], next: ref }
}

// ── Blanket order release ──

/** Blanket order states are plain lowercase strings; only a draft blanket can be released. */
export const isBlanketReleasable = (row: RowValueMap) => String(firstNonNullKey(row, "state") ?? "") === "draft"

/** Resolve the reducer's persisted, idempotent blanket-release identity. */
export function resolveBlanketReleaseEffect(
  blanketOrderId: string,
  idempotencyKey: string,
  releases: readonly RowValueMap[],
): ObservedTransition | undefined {
  const matched = releases.filter((row) => {
    const blanket = firstNonNullKey(row, "blanketOrderId", "blanket_order_id")
    const key = firstNonNullKey(row, "idempotencyKey", "idempotency_key")
    return blanket != null && String(blanket) === blanketOrderId && String(key ?? "") === idempotencyKey
  })
  if (matched.length === 0) return undefined
  if (matched.length > 1) {
    throw new Error(`Expected one blanket release for ${blanketOrderId}/${idempotencyKey}, found ${matched.length}`)
  }
  const purchaseOrderId = firstNonNullKey(matched[0]!, "purchaseOrderId", "purchase_order_id")
  if (purchaseOrderId == null) {
    throw new Error(`Blanket release ${blanketOrderId}/${idempotencyKey} has no purchase order`)
  }
  const ref = recordRef(purchaseOrderWorkflow.resource, purchaseOrderId as string | number | bigint, purchaseOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [ref], next: ref }
}

/** A missing post-dispatch release row is an unresolved outcome, never implicit success. */
export function observeBlanketRelease(
  blanketOrderId: string,
  idempotencyKey: string,
  releases: readonly RowValueMap[],
): ObservedTransition {
  const observed = resolveBlanketReleaseEffect(blanketOrderId, idempotencyKey, releases)
  if (!observed) {
    throw new Error(`Expected one blanket release for ${blanketOrderId}/${idempotencyKey}, found none`)
  }
  return observed
}

export interface ReleaseBlanketInput<TParams> {
  blanketOrderId: string
  params: TParams
}

/** Form-backed: the workspace collects release lines, then dispatches the collected params. */
export function releaseBlanketAction<TParams>(options: {
  label: string
  execute: ExecuteAction<ReleaseBlanketInput<TParams>>
}): WorkflowAction<RowValueMap, ReleaseBlanketInput<TParams>> {
  return {
    id: "purchasing.blanket.release",
    label: options.label,
    kind: "form",
    canPresent: isBlanketReleasable,
    execute: options.execute,
  }
}
