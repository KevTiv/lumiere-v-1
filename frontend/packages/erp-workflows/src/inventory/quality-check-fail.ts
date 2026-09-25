import {
  firstNonNullKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const qualityCheckFailWorkflow = defineWorkflow({
  id: "inventory.quality-check.fail",
  resource: "quality_check",
  module: "inventory",
})

export const QUALITY_CHECK_FAIL_AFFECTS = [
  "quality-checks",
  "stock-quants",
] as const

export interface FailQualityCheckInput {
  checkId: string
  productId: string
  lotId?: string
  companyId: string
  quarantineLocationId: string
  qtyFailed: number
  note?: string
}

interface QuantIdentity {
  productId: string
  lotId?: string
  companyId: string
}

export interface QualityCheckFailSnapshot {
  identity: QuantIdentity
  quarantineLocationId: string
  qtyFailed: number
  sourceId: string
  sourceLocationId: string
  sourceQuantityBefore: number
  destinationIdBefore?: string
  destinationQuantityBefore?: number
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
    lotId: optionalId(row, "lotId", "lot_id"),
    companyId: requiredId(row, "companyId", "company_id"),
  }
}

function sameIdentity(row: RowValueMap, identity: QuantIdentity): boolean {
  const candidate = quantIdentity(row)
  return (
    candidate.productId === identity.productId &&
    candidate.lotId === identity.lotId &&
    candidate.companyId === identity.companyId
  )
}

const close = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-9

/**
 * Capture the exact on-hand source quant and optional existing quarantine
 * destination immediately before dispatching `fail_quality_check`. Bounded to
 * exactly one on-hand source and at most one compatible destination quant —
 * more than one of either fails preflight instead of guessing.
 */
export function captureQualityCheckFailSnapshot(
  input: FailQualityCheckInput,
  quantRows: readonly RowValueMap[],
): QualityCheckFailSnapshot | undefined {
  const identity: QuantIdentity = {
    productId: input.productId,
    lotId: input.lotId,
    companyId: input.companyId,
  }
  if (!identity.productId || !identity.companyId) return undefined

  const matches = quantRows.filter((row) => sameIdentity(row, identity))
  const sources = matches.filter(
    (row) =>
      requiredId(row, "locationId", "location_id") !== input.quarantineLocationId,
  )
  const destinations = matches.filter(
    (row) =>
      requiredId(row, "locationId", "location_id") === input.quarantineLocationId,
  )
  if (sources.length !== 1 || destinations.length > 1) return undefined
  const source = sources[0]
  if (!source) return undefined
  const destination = destinations[0]

  return {
    identity,
    quarantineLocationId: input.quarantineLocationId,
    qtyFailed: input.qtyFailed,
    sourceId: rowId(source),
    sourceLocationId: requiredId(source, "locationId", "location_id"),
    sourceQuantityBefore: numberValue(source, "quantity", "quantity"),
    destinationIdBefore: destination ? rowId(destination) : undefined,
    destinationQuantityBefore: destination
      ? numberValue(destination, "quantity", "quantity")
      : undefined,
  }
}

/**
 * Verify exact source depletion and quarantine convergence after
 * `fail_quality_check`.
 *
 * Source: the same id remains at the same location with quantity reduced by
 * exactly `qtyFailed`, or is gone entirely when fully consumed.
 * Destination: an existing quarantine quant keeps its id with quantity
 * increased by exactly `qtyFailed`; no prior quarantine quant requires exactly
 * one new identity-matching quant at the quarantine location. Both cases
 * require zero available quantity — quarantined stock is never ATP-eligible.
 */
export function observeQualityCheckFail(
  _input: FailQualityCheckInput,
  snapshot: QualityCheckFailSnapshot,
  quantRows: readonly RowValueMap[],
): ObservedTransition {
  const expectedSourceQuantity = snapshot.sourceQuantityBefore - snapshot.qtyFailed
  const sourceFullyConsumed = close(expectedSourceQuantity, 0)

  const source = quantRows.find((row) => rowId(row) === snapshot.sourceId)
  if (sourceFullyConsumed) {
    if (source) return {}
  } else if (
    !source ||
    requiredId(source, "locationId", "location_id") !== snapshot.sourceLocationId ||
    !sameIdentity(source, snapshot.identity) ||
    !close(numberValue(source, "quantity", "quantity"), expectedSourceQuantity)
  ) {
    return {}
  }

  if (snapshot.destinationIdBefore) {
    const destination = quantRows.find(
      (row) => rowId(row) === snapshot.destinationIdBefore,
    )
    if (
      !destination ||
      !sameIdentity(destination, snapshot.identity) ||
      !close(
        numberValue(destination, "quantity", "quantity"),
        (snapshot.destinationQuantityBefore ?? 0) + snapshot.qtyFailed,
      ) ||
      numberValue(destination, "availableQuantity", "available_quantity") !== 0
    ) {
      return {}
    }
    const ref = recordRef("stock_quant", snapshot.destinationIdBefore, "inventory")
    return { outcome: "applied", next: ref }
  }

  const created = quantRows.filter(
    (row) =>
      sameIdentity(row, snapshot.identity) &&
      requiredId(row, "locationId", "location_id") === snapshot.quarantineLocationId,
  )
  if (created.length !== 1) return {}
  const destination = created[0]
  if (!destination) return {}
  if (
    !close(numberValue(destination, "quantity", "quantity"), snapshot.qtyFailed) ||
    numberValue(destination, "availableQuantity", "available_quantity") !== 0
  ) {
    return {}
  }
  const ref = recordRef("stock_quant", rowId(destination), "inventory")
  return { outcome: "applied", createdRecords: [ref], next: ref }
}
