import {
  firstNonNullKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const serialReserveWorkflow = defineWorkflow({
  id: "inventory.serial.reserve",
  resource: "stock_production_serial",
  module: "inventory",
})

export const SERIAL_RESERVE_AFFECTS = ["stock-production-serials"] as const

export interface ReserveSerialInput {
  serialId: string
}

const serialState = (row: RowValueMap): string =>
  String(firstNonNullKey(row, "state", "state") ?? "")

export interface SerialReserveSnapshot {
  serialId: string
}

/**
 * Capture the exact serial by id immediately before dispatching
 * `reserve_serial`. The reducer itself requires `state == "free"`; this only
 * confirms the row exists so the readback has something to compare against —
 * it does not duplicate the reducer's own state check.
 */
export function captureSerialReserveSnapshot(
  input: ReserveSerialInput,
  serialRows: readonly RowValueMap[],
): SerialReserveSnapshot | undefined {
  const exists = serialRows.some((row) => rowId(row) === input.serialId)
  if (!exists) return undefined
  return { serialId: input.serialId }
}

/** Verify the exact serial converged to "reserved" after `reserve_serial`. */
export function observeSerialReserve(
  _input: ReserveSerialInput,
  snapshot: SerialReserveSnapshot,
  serialRows: readonly RowValueMap[],
): ObservedTransition {
  const serial = serialRows.find((row) => rowId(row) === snapshot.serialId)
  if (!serial || serialState(serial) !== "reserved") return {}
  const ref = recordRef("stock_production_serial", snapshot.serialId, "inventory")
  return { outcome: "applied", next: ref }
}
