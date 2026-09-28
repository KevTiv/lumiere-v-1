import {
  firstNonNullKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const serialBlockWorkflow = defineWorkflow({
  id: "inventory.serial.block",
  resource: "stock_production_serial",
  module: "inventory",
})

export const SERIAL_BLOCK_AFFECTS = ["stock-production-serials"] as const

export interface BlockSerialInput {
  serialId: string
  reason?: string
}

const serialState = (row: RowValueMap): string =>
  String(firstNonNullKey(row, "state", "state") ?? "")

const serialIsLocked = (row: RowValueMap): boolean =>
  Boolean(firstNonNullKey(row, "isLocked", "is_locked"))

export interface SerialBlockSnapshot {
  serialId: string
}

/**
 * Capture the exact serial by id immediately before dispatching
 * `block_serial`. Unlike reserve/use, block has no required starting state —
 * this only confirms the row exists.
 */
export function captureSerialBlockSnapshot(
  input: BlockSerialInput,
  serialRows: readonly RowValueMap[],
): SerialBlockSnapshot | undefined {
  const exists = serialRows.some((row) => rowId(row) === input.serialId)
  if (!exists) return undefined
  return { serialId: input.serialId }
}

/** Verify the exact serial converged to "blocked" and `is_locked` after `block_serial`. */
export function observeSerialBlock(
  _input: BlockSerialInput,
  snapshot: SerialBlockSnapshot,
  serialRows: readonly RowValueMap[],
): ObservedTransition {
  const serial = serialRows.find((row) => rowId(row) === snapshot.serialId)
  if (!serial || serialState(serial) !== "blocked" || !serialIsLocked(serial)) {
    return {}
  }
  const ref = recordRef("stock_production_serial", snapshot.serialId, "inventory")
  return { outcome: "applied", next: ref }
}
