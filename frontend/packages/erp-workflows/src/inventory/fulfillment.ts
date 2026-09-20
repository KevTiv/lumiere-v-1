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

export type PickingActionId =
  | "confirm"
  | "assign"
  | "assign-user"
  | "partial-validate"
  | "validate"
  | "cancel"

const OPEN_STATES = ["draft", "confirmed", "assigned"] as const

const APPLICABLE_STATES: Record<PickingActionId, readonly string[]> = {
  confirm: ["draft"],
  assign: ["confirmed"],
  "assign-user": OPEN_STATES,
  "partial-validate": ["assigned"],
  validate: ["assigned"],
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
