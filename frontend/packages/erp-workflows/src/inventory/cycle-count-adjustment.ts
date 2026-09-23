import {
  firstNonNullKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const cycleCountAdjustmentWorkflow = defineWorkflow({
  id: "inventory.cycle-count.post",
  resource: "stock_cycle_count",
  module: "inventory",
})

export const CYCLE_COUNT_POST_AFFECTS = [
  "stock-cycle-counts",
  "stock-quants",
] as const

/**
 * The exact quant identity the counted line targets. The wizard already knows this
 * from what the operator entered when recording the line (`record_cycle_count_line`);
 * there is no separate stock-count-sheet subscription to re-derive it from.
 */
export interface PostCycleCountAdjustmentsInput {
  cycleCountId: string
  productId: string
  locationId: string
  lotId?: string
  companyId: string
  /** The counted quantity recorded for this line; the exact value the quant must converge to. */
  countedQty: number
}

interface QuantIdentity {
  productId: string
  locationId: string
  lotId?: string
  companyId: string
}

export interface CycleCountAdjustmentSnapshot {
  identity: QuantIdentity
  countedQty: number
  quantIdBefore?: string
  quantQuantityBefore?: number
}

const optionalId = (row: RowValueMap, camel: string, snake: string): string | undefined => {
  const value = firstNonNullKey(row, camel, snake)
  return value == null ? undefined : String(value)
}

const requiredId = (row: RowValueMap, camel: string, snake: string): string =>
  optionalId(row, camel, snake) ?? ""

const numberValue = (
  row: RowValueMap,
  camel: string,
  snake: string,
): number => {
  const value = firstNonNullKey(row, camel, snake)
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function quantIdentity(row: RowValueMap): QuantIdentity {
  return {
    productId: requiredId(row, "productId", "product_id"),
    locationId: requiredId(row, "locationId", "location_id"),
    lotId: optionalId(row, "lotId", "lot_id"),
    companyId: requiredId(row, "companyId", "company_id"),
  }
}

function sameIdentity(row: RowValueMap, identity: QuantIdentity): boolean {
  const candidate = quantIdentity(row)
  return (
    candidate.productId === identity.productId &&
    candidate.locationId === identity.locationId &&
    candidate.lotId === identity.lotId &&
    candidate.companyId === identity.companyId
  )
}

function quantsMatchingIdentity(
  rows: readonly RowValueMap[],
  identity: QuantIdentity,
): RowValueMap[] {
  return rows.filter((row) => sameIdentity(row, identity))
}

const close = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-9

/**
 * Capture the exact optional pre-existing quant at the counted line's identity,
 * immediately before dispatching `post_cycle_count_adjustments`. More than one
 * compatible quant fails preflight instead of picking one by iteration order.
 */
export function captureCycleCountAdjustmentSnapshot(
  input: PostCycleCountAdjustmentsInput,
  quantRows: readonly RowValueMap[],
): CycleCountAdjustmentSnapshot | undefined {
  const identity: QuantIdentity = {
    productId: input.productId,
    locationId: input.locationId,
    lotId: input.lotId,
    companyId: input.companyId,
  }
  if (!identity.productId || !identity.locationId || !identity.companyId) {
    return undefined
  }

  const matches = quantsMatchingIdentity(quantRows, identity)
  if (matches.length > 1) return undefined
  const existing = matches[0]

  return {
    identity,
    countedQty: input.countedQty,
    quantIdBefore: existing ? rowId(existing) : undefined,
    quantQuantityBefore: existing
      ? numberValue(existing, "quantity", "quantity")
      : undefined,
  }
}

/**
 * Verify the exact quant outcome after posting.
 *
 * Existing quant: the same id must remain at the same identity with quantity
 * equal to the counted value. No prior quant: exactly one identity-matching
 * quant must now exist, with quantity equal to the counted value.
 */
export function observeCycleCountAdjustment(
  _input: PostCycleCountAdjustmentsInput,
  snapshot: CycleCountAdjustmentSnapshot,
  quantRows: readonly RowValueMap[],
): ObservedTransition {
  if (snapshot.quantIdBefore) {
    const quant = quantRows.find((row) => rowId(row) === snapshot.quantIdBefore)
    if (
      !quant ||
      !sameIdentity(quant, snapshot.identity) ||
      !close(numberValue(quant, "quantity", "quantity"), snapshot.countedQty)
    ) {
      return {}
    }
    const ref = recordRef("stock_quant", snapshot.quantIdBefore, "inventory")
    return { outcome: "applied", next: ref }
  }

  const matches = quantsMatchingIdentity(quantRows, snapshot.identity).filter((row) =>
    close(numberValue(row, "quantity", "quantity"), snapshot.countedQty),
  )
  if (matches.length !== 1) return {}
  const created = matches[0]
  if (!created) return {}
  const ref = recordRef("stock_quant", rowId(created), "inventory")
  return { outcome: "applied", createdRecords: [ref], next: ref }
}
