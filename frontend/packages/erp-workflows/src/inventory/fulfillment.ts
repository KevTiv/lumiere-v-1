/**
 * Pure stock-picking fulfillment rules shared by every surface that operates a picking
 * (Sales fulfillment, Inventory transfers).
 *
 * Presentation only: these helpers decide which actions are worth offering for a picking
 * state. The reducers remain the authority and re-validate every transition.
 *
 * State machine (mirrors `stock.rs`): draft → confirmed → assigned → done, cancellable
 * until done.
 */

import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import { recordAction, type WorkflowAction, type WorkflowExecuteContext } from "../core/action"
import { recordRef } from "../core/record-ref"
import type { WorkflowResult } from "../core/result"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const pickingWorkflow = defineWorkflow({
  id: "inventory.picking",
  resource: "stock_picking",
  module: "inventory",
})

/**
 * Orders whose delivered/received quantities, invoiceable quantities and linked pickings change
 * when a picking transitions. Every picking transition must refresh these alongside inventory.
 */
export const PICKING_ORDER_RESOURCES = [
  "sale-orders",
  "sale-order-lines",
  "purchase-orders",
  "purchase-order-lines",
] as const

/**
 * Every inventory read model a stock operation can change. The single source for what an
 * inventory mutation refreshes, so a surface cannot forget a list the operation touched.
 */
export const INVENTORY_QUERY_RESOURCES = [
  "products",
  "product-categories",
  "stock-locations",
  "stock-quants",
  "stock-pickings",
  "inventory-adjustments",
  "stock-production-lots",
  "warehouses",
  "quality-checks",
  "quality-alerts",
  "warehouse-3d-zones",
  "stock-cycle-counts",
  "warehouse-3d",
  "stock-inventories",
  "stock-moves",
  "stock-production-serials",
  "adjustment-reasons",
  "barcode-nomenclatures",
  "serial-lot-traceability",
  "stock-traceability-reports",
  "stock-packages",
  "inventory-exceptions",
  "inventory-exceptions-short-atp",
  "inventory-exceptions-expired-lots",
  "inventory-exceptions-open-qc",
] as const

/** A picking transition changes stock and the order that originated it (delivered/received qty, backorders). */
export const PICKING_TRANSITION_AFFECTS = [...INVENTORY_QUERY_RESOURCES, ...PICKING_ORDER_RESOURCES] as const

export type PickingActionId =
  | "confirm"
  | "assign"
  | "assign-user"
  | "partial-validate"
  | "validate"
  | "pack"
  | "cancel"

const OPEN_STATES = ["draft", "confirmed", "assigned"] as const

const APPLICABLE_STATES: Record<PickingActionId, readonly string[]> = {
  confirm: ["draft"],
  assign: ["confirmed"],
  "assign-user": OPEN_STATES,
  "partial-validate": ["assigned"],
  validate: ["assigned"],
  pack: ["assigned"],
  cancel: OPEN_STATES,
}

export function pickingStateTag(row: RowValueMap): string {
  const state = firstNonNullKey(row, "state")
  return typeof state === "string" ? state.toLowerCase() : ""
}

export function isPickingActionApplicable(action: PickingActionId, row: RowValueMap): boolean {
  return APPLICABLE_STATES[action].includes(pickingStateTag(row))
}

/** True when every selected picking accepts the action (an empty selection never does). */
export function isPickingActionApplicableToAll(
  action: PickingActionId,
  rows: readonly RowValueMap[],
): boolean {
  return rows.length > 0 && rows.every((row) => isPickingActionApplicable(action, row))
}

export interface PartialDeliveryLine {
  moveId: string
  orderedQty: number
}

export type PartialDeliveryError = "qtyRequired" | "invalidQty"

export type PartialDeliveryPlan =
  | {
      ok: true
      /** Moves whose done quantity must be recorded before validation (short-shipped). */
      shortMoves: Array<{ moveId: string; quantityDone: number }>
    }
  | { ok: false; error: PartialDeliveryError }

/**
 * Turn the partial-delivery form (`qty_<moveId>` fields) into the `done_stock_move` calls that
 * must precede validation.
 *
 * `quantity_done = 0` means "not recorded" to `validate_stock_picking` and ships the full
 * demand, so zero is rejected rather than treated as "skip this line". Lines delivered in
 * full need no `done_stock_move` call.
 */
export function planPartialDelivery(
  lines: readonly PartialDeliveryLine[],
  formData: RowValueMap,
): PartialDeliveryPlan {
  const shortMoves: Array<{ moveId: string; quantityDone: number }> = []
  for (const line of lines) {
    const raw = formData[`qty_${line.moveId}`]
    const qty = raw === "" || raw == null ? Number.NaN : Number(raw)
    if (!Number.isFinite(qty)) return { ok: false, error: "qtyRequired" }
    if (qty <= 0 || qty > line.orderedQty) return { ok: false, error: "invalidQty" }
    if (qty < line.orderedQty) shortMoves.push({ moveId: line.moveId, quantityDone: qty })
  }
  return { ok: true, shortMoves }
}

export type PickingStep = "confirm" | "assign" | "validate"

const STEPS_FROM_STATE: Record<string, readonly PickingStep[]> = {
  draft: ["confirm", "assign", "validate"],
  confirmed: ["assign", "validate"],
  assigned: ["validate"],
  done: [],
}

/**
 * The commands still needed to take a picking to done from its current state, or undefined when
 * it cannot reach done (cancelled/unknown). Lets a surface complete a picking in one run (e.g.
 * receiving a return) without replaying steps the picking has already passed.
 */
export function pickingStepsToDone(row: RowValueMap): readonly PickingStep[] | undefined {
  return STEPS_FROM_STATE[pickingStateTag(row)]
}

/**
 * Where a validated picking's short-shipped remainder went: the backorder picking the reducer
 * created (linked by `backorder_id`), newest first. A validation without a backorder claims nothing.
 */
export function observeValidatedPicking(pickingId: string, pickings: readonly RowValueMap[]): ObservedTransition {
  const source = pickings.find((row) => rowId(row) === pickingId)
  const backorders = pickings
    .filter((row) => String(firstNonNullKey(row, "backorderId", "backorder_id") ?? "") === pickingId)
    .sort((a, b) => Number(rowId(b)) - Number(rowId(a)))
  if (backorders.length === 0) return source ? { outcome: "applied" } : {}
  const context = firstNonNullKey(source ?? {}, "saleId", "sale_id") != null ? "sales" : undefined
  return {
    outcome: "applied",
    createdRecords: backorders.map((row) => recordRef(pickingWorkflow.resource, rowId(row), pickingWorkflow.module, context)),
  }
}

interface PickingRecordActionOptions {
  label: string
  execute(pickingId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}

const pickingAction = (
  id: PickingActionId,
  kind: "immediate" | "destructive",
  options: PickingRecordActionOptions,
): WorkflowAction<RowValueMap, string> =>
  recordAction(`inventory.picking.${id}`, kind, (row) => isPickingActionApplicable(id, row), options)

export const confirmPickingAction = (o: PickingRecordActionOptions) => pickingAction("confirm", "immediate", o)
export const assignPickingAction = (o: PickingRecordActionOptions) => pickingAction("assign", "immediate", o)
export const validatePickingAction = (o: PickingRecordActionOptions) => pickingAction("validate", "immediate", o)
export const packPickingAction = (o: PickingRecordActionOptions) => pickingAction("pack", "immediate", o)
export const cancelPickingAction = (o: PickingRecordActionOptions) => pickingAction("cancel", "destructive", o)

export interface ValidatePickingWithQuantitiesInput {
  pickingId: string
  /** Moves shipped short: their done quantity is recorded before validation (see `planPartialDelivery`). */
  shortMoves: ReadonlyArray<{ moveId: string; quantityDone: number }>
  createBackorder: boolean
}

/** Form-backed: the surface collects the delivered quantities and whether to keep a backorder. */
export function partialValidatePickingAction(options: {
  label: string
  execute(input: ValidatePickingWithQuantitiesInput, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, ValidatePickingWithQuantitiesInput> {
  return {
    id: "inventory.picking.partial-validate",
    label: options.label,
    kind: "form",
    canPresent: (row) => isPickingActionApplicable("partial-validate", row),
    execute: options.execute,
  }
}
