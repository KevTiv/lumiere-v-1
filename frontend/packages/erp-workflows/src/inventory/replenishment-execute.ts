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
  "stock-pickings",
] as const

export interface ExecuteReplenishmentRuleInput {
  ruleId: string
  idempotencyKey: string
}

const requiredId = (row: RowValueMap, camel: string, snake: string): string => {
  const value = firstNonNullKey(row, camel, snake)
  return value == null ? "" : String(value)
}

const stateTag = (row: RowValueMap): string => {
  const value = firstNonNullKey(row, "state", "state")
  if (value != null && typeof value === "object" && "tag" in (value as object)) {
    return String((value as { tag: unknown }).tag).toLowerCase()
  }
  return String(value ?? "").toLowerCase()
}

/** The exact draft PO identity the buy-demand path creates, never guessed by newest/highest id. */
function partnerRefForRule(ruleId: string): string {
  return `RPL-${ruleId}`
}

/** The exact internal-transfer picking identity the transfer-demand path creates. */
function pickingNameForRule(ruleId: string): string {
  return `INT-RPL-${ruleId}`
}

function matchingOpenPurchaseOrders(
  rows: readonly RowValueMap[],
  partnerRef: string,
): RowValueMap[] {
  return rows.filter(
    (row) => requiredId(row, "partnerRef", "partner_ref") === partnerRef,
  )
}

function matchingOpenPickings(
  rows: readonly RowValueMap[],
  pickingName: string,
): RowValueMap[] {
  return rows.filter(
    (row) =>
      requiredId(row, "name", "name") === pickingName &&
      stateTag(row) !== "done" &&
      stateTag(row) !== "cancel",
  )
}

export interface ReplenishmentExecutionSnapshot {
  ruleId: string
  partnerRef: string
  pickingName: string
  poIdBefore?: string
  pickingIdBefore?: string
}

/**
 * Capture the optional pre-existing demand — a draft PO (buy path) or an open
 * internal-transfer picking (transfer path) — for this rule's exact identity
 * immediately before dispatch. Which path a rule takes is determined server
 * side (a configured vendor takes the buy path; otherwise a source location
 * with stock takes the transfer path) and is not guessed here. More than one
 * compatible match on either side fails preflight instead of picking one by
 * iteration order.
 */
export function captureReplenishmentExecutionSnapshot(
  input: ExecuteReplenishmentRuleInput,
  purchaseOrderRows: readonly RowValueMap[],
  stockPickingRows: readonly RowValueMap[],
): ReplenishmentExecutionSnapshot | undefined {
  const partnerRef = partnerRefForRule(input.ruleId)
  const pickingName = pickingNameForRule(input.ruleId)

  const poMatches = matchingOpenPurchaseOrders(purchaseOrderRows, partnerRef)
  const pickingMatches = matchingOpenPickings(stockPickingRows, pickingName)
  if (poMatches.length > 1 || pickingMatches.length > 1) return undefined

  return {
    ruleId: input.ruleId,
    partnerRef,
    pickingName,
    poIdBefore: poMatches[0] ? rowId(poMatches[0]) : undefined,
    pickingIdBefore: pickingMatches[0] ? rowId(pickingMatches[0]) : undefined,
  }
}

/**
 * Verify the exact demand outcome after `execute_replenishment_rule`, on
 * whichever side (buy PO or transfer picking) this rule's snapshot found.
 *
 * A pre-existing demand (idempotent replay) must remain the exact same id.
 * No prior demand requires exactly one new identity-matching row on exactly
 * one side — not both, and not neither.
 */
export function observeReplenishmentExecution(
  _input: ExecuteReplenishmentRuleInput,
  snapshot: ReplenishmentExecutionSnapshot,
  purchaseOrderRows: readonly RowValueMap[],
  stockPickingRows: readonly RowValueMap[],
): ObservedTransition {
  const poMatches = matchingOpenPurchaseOrders(purchaseOrderRows, snapshot.partnerRef)
  const pickingMatches = matchingOpenPickings(stockPickingRows, snapshot.pickingName)

  if (snapshot.poIdBefore) {
    if (poMatches.length !== 1 || rowId(poMatches[0] as RowValueMap) !== snapshot.poIdBefore) {
      return {}
    }
    const ref = recordRef("purchase_order", snapshot.poIdBefore, undefined, "inventory")
    return { outcome: "applied", next: ref }
  }

  if (snapshot.pickingIdBefore) {
    if (
      pickingMatches.length !== 1 ||
      rowId(pickingMatches[0] as RowValueMap) !== snapshot.pickingIdBefore
    ) {
      return {}
    }
    const ref = recordRef("stock_picking", snapshot.pickingIdBefore, "inventory")
    return { outcome: "applied", next: ref }
  }

  if (poMatches.length === 1 && pickingMatches.length === 0) {
    const created = poMatches[0] as RowValueMap
    const ref = recordRef("purchase_order", rowId(created), undefined, "inventory")
    return { outcome: "applied", createdRecords: [ref], next: ref }
  }

  if (pickingMatches.length === 1 && poMatches.length === 0) {
    const created = pickingMatches[0] as RowValueMap
    const ref = recordRef("stock_picking", rowId(created), "inventory")
    return { outcome: "applied", createdRecords: [ref], next: ref }
  }

  return {}
}
