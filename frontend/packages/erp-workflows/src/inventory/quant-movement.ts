import {
  firstNonNullKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const stockQuantWorkflow = defineWorkflow({
  id: "inventory.stock-quant",
  resource: "stock_quant",
  module: "inventory",
})

export const STOCK_QUANT_MOVE_AFFECTS = [
  "stock-quants",
  "products",
  "warehouse-3d-zones",
] as const

export interface MoveStockQuantInput {
  quantId: string
  targetLocationId: string
  quantity: number
}

interface QuantIdentity {
  productId: string
  productVariantId?: string
  lotId?: string
  packageId?: string
  ownerId?: string
  companyId: string
}

export interface StockQuantMoveSnapshot {
  sourceId: string
  sourceLocationId: string
  sourceQuantity: number
  sourceAvailableQuantity: number
  identity: QuantIdentity
  destinationLocationId: string
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
    productVariantId: optionalId(row, "productVariantId", "product_variant_id"),
    lotId: optionalId(row, "lotId", "lot_id"),
    packageId: optionalId(row, "packageId", "package_id"),
    ownerId: optionalId(row, "ownerId", "owner_id"),
    companyId: requiredId(row, "companyId", "company_id"),
  }
}

function sameIdentity(row: RowValueMap, identity: QuantIdentity): boolean {
  const candidate = quantIdentity(row)
  return (
    candidate.productId === identity.productId &&
    candidate.productVariantId === identity.productVariantId &&
    candidate.lotId === identity.lotId &&
    candidate.packageId === identity.packageId &&
    candidate.ownerId === identity.ownerId &&
    candidate.companyId === identity.companyId
  )
}

function quantsAtDestination(
  rows: readonly RowValueMap[],
  identity: QuantIdentity,
  destinationLocationId: string,
): RowValueMap[] {
  return rows.filter(
    (row) =>
      requiredId(row, "locationId", "location_id") === destinationLocationId &&
      sameIdentity(row, identity),
  )
}

/**
 * Capture the exact source and optional existing destination immediately before dispatch.
 * Ambiguous compatible destination rows fail preflight instead of being reduced by row order.
 */
export function captureStockQuantMoveSnapshot(
  input: MoveStockQuantInput,
  rows: readonly RowValueMap[],
): StockQuantMoveSnapshot | undefined {
  const source = rows.find((row) => rowId(row) === input.quantId)
  if (!source) return undefined

  const sourceLocationId = requiredId(source, "locationId", "location_id")
  if (!sourceLocationId || sourceLocationId === input.targetLocationId) return undefined

  const identity = quantIdentity(source)
  if (!identity.productId || !identity.companyId) return undefined

  const destinations = quantsAtDestination(
    rows,
    identity,
    input.targetLocationId,
  ).filter((row) => rowId(row) !== input.quantId)
  if (destinations.length > 1) return undefined

  const destination = destinations[0]
  return {
    sourceId: input.quantId,
    sourceLocationId,
    sourceQuantity: numberValue(source, "quantity", "quantity"),
    sourceAvailableQuantity: numberValue(
      source,
      "availableQuantity",
      "available_quantity",
    ),
    identity,
    destinationLocationId: input.targetLocationId,
    destinationIdBefore: destination ? rowId(destination) : undefined,
    destinationQuantityBefore: destination
      ? numberValue(destination, "quantity", "quantity")
      : undefined,
  }
}

const close = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-9

/**
 * Verify exact source/destination convergence after move_stock_quant.
 *
 * Existing destination: verify that exact destination id.
 * No destination + full move: the source id itself relocates.
 * No destination + partial move: require exactly one new identity-matching destination id.
 */
export function observeStockQuantMove(
  input: MoveStockQuantInput,
  snapshot: StockQuantMoveSnapshot,
  rows: readonly RowValueMap[],
): ObservedTransition {
  const fullMove = close(input.quantity, snapshot.sourceQuantity)
  const expectedSourceQuantity = snapshot.sourceQuantity - input.quantity

  if (snapshot.destinationIdBefore) {
    const destination = rows.find(
      (row) => rowId(row) === snapshot.destinationIdBefore,
    )
    if (
      !destination ||
      requiredId(destination, "locationId", "location_id") !==
        snapshot.destinationLocationId ||
      !sameIdentity(destination, snapshot.identity) ||
      !close(
        numberValue(destination, "quantity", "quantity"),
        (snapshot.destinationQuantityBefore ?? 0) + input.quantity,
      )
    ) {
      return {}
    }

    const source = rows.find((row) => rowId(row) === snapshot.sourceId)
    if (fullMove) {
      if (source) return {}
    } else if (
      !source ||
      requiredId(source, "locationId", "location_id") !==
        snapshot.sourceLocationId ||
      !sameIdentity(source, snapshot.identity) ||
      !close(numberValue(source, "quantity", "quantity"), expectedSourceQuantity)
    ) {
      return {}
    }

    const destinationRef = recordRef(
      stockQuantWorkflow.resource,
      snapshot.destinationIdBefore,
      stockQuantWorkflow.module,
    )
    return {
      outcome: "applied",
      next: destinationRef,
    }
  }

  if (fullMove) {
    const relocated = rows.find((row) => rowId(row) === snapshot.sourceId)
    if (
      !relocated ||
      requiredId(relocated, "locationId", "location_id") !==
        snapshot.destinationLocationId ||
      !sameIdentity(relocated, snapshot.identity) ||
      !close(
        numberValue(relocated, "quantity", "quantity"),
        snapshot.sourceQuantity,
      )
    ) {
      return {}
    }
    return {
      outcome: "applied",
      next: recordRef(
        stockQuantWorkflow.resource,
        snapshot.sourceId,
        stockQuantWorkflow.module,
      ),
    }
  }

  const source = rows.find((row) => rowId(row) === snapshot.sourceId)
  if (
    !source ||
    requiredId(source, "locationId", "location_id") !== snapshot.sourceLocationId ||
    !sameIdentity(source, snapshot.identity) ||
    !close(numberValue(source, "quantity", "quantity"), expectedSourceQuantity)
  ) {
    return {}
  }

  const destinations = quantsAtDestination(
    rows,
    snapshot.identity,
    snapshot.destinationLocationId,
  ).filter((row) => rowId(row) !== snapshot.sourceId)
  if (destinations.length !== 1) return {}

  const destination = destinations[0]
  if (!close(numberValue(destination, "quantity", "quantity"), input.quantity)) {
    return {}
  }

  const destinationRef = recordRef(
    stockQuantWorkflow.resource,
    rowId(destination),
    stockQuantWorkflow.module,
  )
  return {
    outcome: "applied",
    createdRecords: [destinationRef],
    next: destinationRef,
  }
}
