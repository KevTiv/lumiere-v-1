import {
  firstNonNullKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const replenishmentExecutionWorkflow = defineWorkflow({
  id: "inventory.replenishment.execute",
  resource: "replenishment_rule",
  module: "inventory",
})

export const REPLENISHMENT_EXECUTE_AFFECTS = [
  "replenishment-rules",
  "purchase-orders",
] as const

export interface ExecuteReplenishmentRuleInput {
  ruleId: string
  idempotencyKey: string
}

const requiredId = (row: RowValueMap, camel: string, snake: string): string => {
  const value = firstNonNullKey(row, camel, snake)
  return value == null ? "" : String(value)
}

/**
 * The exact draft PO identity this rule's buy-demand path creates
 * (`partner_ref = "RPL-<ruleId>"`), never guessed by newest/highest id.
 */
function partnerRefForRule(ruleId: string): string {
  return `RPL-${ruleId}`
}

export interface ReplenishmentExecutionSnapshot {
  ruleId: string
  partnerRef: string
  poIdBefore?: string
}

/**
 * Capture the optional pre-existing draft PO for this rule's buy-demand
 * identity immediately before dispatch. More than one compatible PO fails
 * preflight instead of picking one by iteration order.
 */
export function captureReplenishmentExecutionSnapshot(
  input: ExecuteReplenishmentRuleInput,
  purchaseOrderRows: readonly RowValueMap[],
): ReplenishmentExecutionSnapshot | undefined {
  const partnerRef = partnerRefForRule(input.ruleId)
  const matches = purchaseOrderRows.filter(
    (row) => requiredId(row, "partnerRef", "partner_ref") === partnerRef,
  )
  if (matches.length > 1) return undefined
  const existing = matches[0]

  return {
    ruleId: input.ruleId,
    partnerRef,
    poIdBefore: existing ? rowId(existing) : undefined,
  }
}

/**
 * Verify the exact buy-demand PO outcome after `execute_replenishment_rule`.
 *
 * A pre-existing PO (idempotent replay) must remain the exact same id. No
 * prior PO requires exactly one new identity-matching PO to now exist.
 */
export function observeReplenishmentExecution(
  _input: ExecuteReplenishmentRuleInput,
  snapshot: ReplenishmentExecutionSnapshot,
  purchaseOrderRows: readonly RowValueMap[],
): ObservedTransition {
  const matches = purchaseOrderRows.filter(
    (row) => requiredId(row, "partnerRef", "partner_ref") === snapshot.partnerRef,
  )

  if (snapshot.poIdBefore) {
    if (matches.length !== 1 || rowId(matches[0] as RowValueMap) !== snapshot.poIdBefore) {
      return {}
    }
    const ref = recordRef("purchase_order", snapshot.poIdBefore, undefined, "inventory")
    return { outcome: "applied", next: ref }
  }

  if (matches.length !== 1) return {}
  const created = matches[0]
  if (!created) return {}
  const ref = recordRef("purchase_order", rowId(created), undefined, "inventory")
  return { outcome: "applied", createdRecords: [ref], next: ref }
}
