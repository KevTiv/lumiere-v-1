import {
  firstNonNullKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const serialUseWorkflow = defineWorkflow({
  id: "inventory.serial.use",
  resource: "stock_production_serial",
  module: "inventory",
})

export const SERIAL_USE_AFFECTS = ["stock-production-serials"] as const

export interface UseSerialInput {
  serialId: string
}

const serialState = (row: RowValueMap): string =>
  String(firstNonNullKey(row, "state", "state") ?? "")

export interface SerialUseSnapshot {
  serialId: string
}

/**
 * Capture the exact serial by id immediately before dispatching `use_serial`.
 * The reducer itself requires `state == "reserved"`; this only confirms the
 * row exists so the readback has something to compare against.
 */
export function captureSerialUseSnapshot(
  input: UseSerialInput,
  serialRows: readonly RowValueMap[],
): SerialUseSnapshot | undefined {
  const exists = serialRows.some((row) => rowId(row) === input.serialId)
  if (!exists) return undefined
  return { serialId: input.serialId }
}

/** Verify the exact serial converged to "in_use" after `use_serial`. */
export function observeSerialUse(
  _input: UseSerialInput,
  snapshot: SerialUseSnapshot,
  serialRows: readonly RowValueMap[],
): ObservedTransition {
  const serial = serialRows.find((row) => rowId(row) === snapshot.serialId)
  if (!serial || serialState(serial) !== "in_use") return {}
  const ref = recordRef("stock_production_serial", snapshot.serialId, "inventory")
  return { outcome: "applied", next: ref }
}
