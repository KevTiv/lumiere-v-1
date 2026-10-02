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
export const APPLY_LANDED_COST_AFFECTS = [...LANDED_COST_DRAFT_AFFECTS, "stock-quants", "landed-cost-applications"] as const
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

/**
 * `apply_landed_costs` commits one `stock_landed_cost_application` row per landed cost (unique by
 * `landed_cost_id`); a retry converges on the same row. Exactly that one row is the effect.
 */
export function observeLandedCostApplied(landedCostId: string, applications: readonly RowValueMap[]): ObservedTransition {
  const matches = applications.filter(
    (row) => String(firstNonNullKey(row, "landedCostId", "landed_cost_id") ?? "") === landedCostId,
  )
  if (matches.length !== 1) return {}
  return { outcome: "applied", next: recordRef(landedCostWorkflow.resource, landedCostId, landedCostWorkflow.module) }
}

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

const BLANKET_ORIGIN = /^blanket:(\d+)$/

/**
 * `release_blanket_to_po` commits one `purchase_blanket_release` row per idempotency key, naming
 * the PO it created. The release is confirmed only by that exact (blanket, key) row, and the PO it
 * names must exist with the `blanket:<id>` origin stamp. A replay of the same key converges on
 * the same row; zero or several rows are unresolved.
 */
export function observeBlanketRelease(
  blanketOrderId: string,
  idempotencyKey: string,
  releases: readonly RowValueMap[],
  orders: readonly RowValueMap[],
): ObservedTransition {
  const key = idempotencyKey.trim()
  const matches = releases.filter(
    (row) =>
      String(firstNonNullKey(row, "blanketOrderId", "blanket_order_id") ?? "") === blanketOrderId &&
      String(firstNonNullKey(row, "idempotencyKey", "idempotency_key") ?? "") === key,
  )
  if (matches.length !== 1) return {}
  const poId = firstNonNullKey(matches[0], "purchaseOrderId", "purchase_order_id")
  if (poId == null) return {}
  const order = orders.find((row) => rowId(row) === String(poId))
  if (!order || BLANKET_ORIGIN.exec(String(firstNonNullKey(order, "origin") ?? ""))?.[1] !== blanketOrderId) {
    return {}
  }
  const ref = recordRef(purchaseOrderWorkflow.resource, String(poId), purchaseOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [ref], next: ref }
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
