import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import type { ErpRecordRef } from "./record-ref"
import { normalizedTag, rowId } from "./row"
import type { ObservedTransition } from "./transition"

/**
 * Readback for an in-place transition: the exact record `ref` names must read back satisfying
 * `confirmed`. A missing record or any other state is unresolved; no other row can stand in.
 */
export function observeSameRecord(
  ref: ErpRecordRef,
  rows: readonly RowValueMap[],
  confirmed: (row: RowValueMap) => boolean,
): ObservedTransition {
  const row = rows.find((candidate) => rowId(candidate) === ref.id)
  return row && confirmed(row) ? { outcome: "applied", next: ref } : {}
}

/** The row's `state` is `expected` (enum `{tag}`, PascalCase and snake_case compare equal). */
export const stateIs =
  (expected: string) =>
  (row: RowValueMap): boolean =>
    normalizedTag(firstNonNullKey(row, "state")) === normalizedTag(expected)
