"use client"

import { decodeOperationDispatch } from "@lumiere/api-client"
import { parseStrictU64, scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { invalidateResourceQueries } from "../subscription-query"
import {
  AmbiguousOperationEffectError,
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  resolveUniqueEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

const PRODUCE_AFFECTS = ["mrp-productions"] as const
const FINISH_AFFECTS = ["mrp-productions", "stock-moves", "stock-quants"] as const

export interface ManufacturingCloseOrderProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly productId?: unknown
  readonly product_id?: unknown
  readonly productQty?: unknown
  readonly product_qty?: unknown
  readonly productUomId?: unknown
  readonly product_uom_id?: unknown
  readonly qtyProduced?: unknown
  readonly qty_produced?: unknown
  readonly qtyProducing?: unknown
  readonly qty_producing?: unknown
  readonly locationSrcId?: unknown
  readonly location_src_id?: unknown
  readonly locationDestId?: unknown
  readonly location_dest_id?: unknown
  readonly moveFinishedIds?: unknown
  readonly move_finished_ids?: unknown
  readonly moveFinishedCount?: unknown
  readonly move_finished_count?: unknown
}

export interface ManufacturingFinishedMoveProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly productionId?: unknown
  readonly production_id?: unknown
  readonly productId?: unknown
  readonly product_id?: unknown
  readonly productUom?: unknown
  readonly product_uom?: unknown
  readonly productUomQty?: unknown
  readonly product_uom_qty?: unknown
  readonly locationId?: unknown
  readonly location_id?: unknown
  readonly locationDestId?: unknown
  readonly location_dest_id?: unknown
  readonly state?: unknown
  readonly isDone?: unknown
  readonly is_done?: unknown
  readonly quantityDone?: unknown
  readonly quantity_done?: unknown
}

export interface ManufacturingFinishedQuantProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly productId?: unknown
  readonly product_id?: unknown
  readonly locationId?: unknown
  readonly location_id?: unknown
  readonly lotId?: unknown
  readonly lot_id?: unknown
  readonly packageId?: unknown
  readonly package_id?: unknown
  readonly ownerId?: unknown
  readonly owner_id?: unknown
  readonly quantity?: unknown
}

export interface ManufacturingProductionEffectRef extends CanonicalRecordRef {
  readonly resource: "mrp-productions"
  readonly companyId: string
  readonly qtyProduced: number
  readonly state: "progress" | "toclose"
}

export interface ManufacturingFinishedEffectRef extends CanonicalRecordRef {
  readonly resource: "mrp-productions"
  readonly companyId: string
  readonly finishedMoveId: string
  readonly destinationQuantId: string
}

export interface DestinationQuantSnapshot {
  readonly id?: bigint
  readonly quantity: number
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.toLowerCase()
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
  }
  return String(value).toLowerCase()
}

function optionIsAbsent(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === "object" && !Array.isArray(value) && value !== null) {
    const keys = Object.keys(value)
    return keys.length === 1 && keys[0] === "none"
  }
  return false
}

function sameQty(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9
}

function parseIdList(value: unknown): bigint[] | null {
  if (!Array.isArray(value)) return null
  const ids: bigint[] = []
  for (const item of value) {
    const id = parseStrictU64(item)
    if (id == null || id === 0n) return null
    ids.push(id)
  }
  return ids
}

function exactOrder(
  rows: readonly ManufacturingCloseOrderProjection[],
  manufacturingOrderId: bigint,
  companyId: bigint,
): ManufacturingCloseOrderProjection | null {
  const matched = rows.filter(
    (row) =>
      parseStrictU64(row.id) === manufacturingOrderId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId,
  )
  if (matched.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one manufacturing order, found ${matched.length}`,
    )
  }
  return matched[0] ?? null
}

export function resolveManufacturingProductionQuantityEffect(
  rows: readonly ManufacturingCloseOrderProjection[],
  manufacturingOrderId: bigint,
  companyId: bigint,
  expectedQtyProduced: number,
  expectedState: "progress" | "toclose",
): ManufacturingProductionEffectRef | null {
  return resolveUniqueEffect(
    rows,
    (row) =>
      parseStrictU64(row.id) === manufacturingOrderId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId &&
      stateTag(row.state) === expectedState &&
      sameQty(numeric(row.qtyProduced ?? row.qty_produced) ?? Number.NaN, expectedQtyProduced),
    (row) => ({
      resource: "mrp-productions",
      id: String(parseStrictU64(row.id)),
      companyId: companyId.toString(),
      qtyProduced: expectedQtyProduced,
      state: expectedState,
    }),
  )
}

function exactDestinationQuant(
  quants: readonly ManufacturingFinishedQuantProjection[],
  companyId: bigint,
  productId: bigint,
  locationId: bigint,
): ManufacturingFinishedQuantProjection | null {
  const matches = quants.filter(
    (row) =>
      parseStrictU64(row.companyId ?? row.company_id) === companyId &&
      parseStrictU64(row.productId ?? row.product_id) === productId &&
      parseStrictU64(row.locationId ?? row.location_id) === locationId &&
      optionIsAbsent(row.lotId ?? row.lot_id) &&
      optionIsAbsent(row.packageId ?? row.package_id) &&
      optionIsAbsent(row.ownerId ?? row.owner_id),
  )
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected at most one finished-goods quant, found ${matches.length}`,
    )
  }
  return matches[0] ?? null
}

export function resolveManufacturingFinishedEffect(
  orders: readonly ManufacturingCloseOrderProjection[],
  stockMoves: readonly ManufacturingFinishedMoveProjection[],
  quants: readonly ManufacturingFinishedQuantProjection[],
  manufacturingOrderId: bigint,
  companyId: bigint,
  destinationBefore: DestinationQuantSnapshot,
): ManufacturingFinishedEffectRef | null {
  const order = exactOrder(orders, manufacturingOrderId, companyId)
  if (!order || stateTag(order.state) !== "done") return null

  const productId = parseStrictU64(order.productId ?? order.product_id)
  const productUomId = parseStrictU64(order.productUomId ?? order.product_uom_id)
  const sourceLocationId = parseStrictU64(order.locationSrcId ?? order.location_src_id)
  const destinationLocationId = parseStrictU64(order.locationDestId ?? order.location_dest_id)
  const producedQty = numeric(order.qtyProduced ?? order.qty_produced)
  const plannedQty = numeric(order.productQty ?? order.product_qty)
  const finishedIds = parseIdList(order.moveFinishedIds ?? order.move_finished_ids)
  const finishedCount = numeric(order.moveFinishedCount ?? order.move_finished_count)
  if (
    productId == null ||
    productUomId == null ||
    sourceLocationId == null ||
    destinationLocationId == null ||
    producedQty == null ||
    plannedQty == null ||
    !sameQty(producedQty, plannedQty) ||
    finishedIds == null ||
    finishedIds.length !== 1 ||
    finishedCount !== 1
  ) {
    return null
  }

  const finishedMoveId = finishedIds[0]!
  const moveMatches = stockMoves.filter(
    (row) => parseStrictU64(row.id) === finishedMoveId,
  )
  if (moveMatches.length !== 1) return null
  const move = moveMatches[0]!
  const moveQty = numeric(move.productUomQty ?? move.product_uom_qty)
  const quantityDone = numeric(move.quantityDone ?? move.quantity_done)
  if (
    parseStrictU64(move.companyId ?? move.company_id) !== companyId ||
    parseStrictU64(move.productionId ?? move.production_id) !== manufacturingOrderId ||
    parseStrictU64(move.productId ?? move.product_id) !== productId ||
    parseStrictU64(move.productUom ?? move.product_uom) !== productUomId ||
    parseStrictU64(move.locationId ?? move.location_id) !== sourceLocationId ||
    parseStrictU64(move.locationDestId ?? move.location_dest_id) !== destinationLocationId ||
    moveQty == null ||
    quantityDone == null ||
    !sameQty(moveQty, producedQty) ||
    !sameQty(quantityDone, producedQty) ||
    stateTag(move.state) !== "done" ||
    (move.isDone ?? move.is_done) === false
  ) {
    return null
  }

  const destinationQuant = exactDestinationQuant(
    quants,
    companyId,
    productId,
    destinationLocationId,
  )
  if (!destinationQuant) return null
  const quantId = parseStrictU64(destinationQuant.id)
  const quantity = numeric(destinationQuant.quantity)
  if (quantId == null || quantity == null) return null
  if (destinationBefore.id != null && quantId !== destinationBefore.id) return null
  if (!sameQty(quantity, destinationBefore.quantity + producedQty)) return null

  return {
    resource: "mrp-productions",
    id: manufacturingOrderId.toString(),
    companyId: companyId.toString(),
    finishedMoveId: finishedMoveId.toString(),
    destinationQuantId: quantId.toString(),
  }
}

async function refreshResources(
  qc: QueryClient,
  organizationId: bigint,
  resources: readonly string[],
): Promise<void> {
  invalidateResourceQueries(qc, organizationId, resources)
  const orgKey = rqBigIntKey(organizationId)
  await Promise.all(
    resources.map((resource) =>
      qc.invalidateQueries({ queryKey: [resource, orgKey] }),
    ),
  )
}

async function readOrders(): Promise<ManufacturingCloseOrderProjection[]> {
  return fetchQueryList(
    "/api/query/mrp-productions",
    "Failed to read manufacturing orders",
  )
}

async function readDestinationSnapshot(
  companyId: bigint,
  productId: bigint,
  destinationLocationId: bigint,
): Promise<DestinationQuantSnapshot> {
  const quants = await fetchQueryList(
    "/api/query/stock-quants",
    "Failed to read finished-goods quant",
  )
  const quant = exactDestinationQuant(
    quants,
    companyId,
    productId,
    destinationLocationId,
  )
  if (!quant) return { quantity: 0 }
  const id = parseStrictU64(quant.id)
  const quantity = numeric(quant.quantity)
  if (id == null || quantity == null) {
    throw new Error("Finished-goods quant has invalid canonical identity")
  }
  return { id, quantity }
}

async function readFinishedEffect(
  manufacturingOrderId: bigint,
  companyId: bigint,
  destinationBefore: DestinationQuantSnapshot,
): Promise<ManufacturingFinishedEffectRef | null> {
  const [orders, stockMoves, quants] = await Promise.all([
    readOrders(),
    fetchQueryList(
      "/api/query/stock-moves",
      "Failed to read finished-goods stock move",
    ),
    fetchQueryList(
      "/api/query/stock-quants",
      "Failed to read finished-goods quant",
    ),
  ])
  return resolveManufacturingFinishedEffect(
    orders,
    stockMoves,
    quants,
    manufacturingOrderId,
    companyId,
    destinationBefore,
  )
}

export function useProduceManufacturingOrder(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()

  return useMutation<
    ResolvedOperationEffectOutcome<ManufacturingProductionEffectRef>,
    Error,
    { moId: ScalarId; qty: number }
  >({
    mutationFn: async ({ moId, qty }) => {
      if (companyId === 0n) throw new Error("Active company required")
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Production quantity must be greater than 0")
      }

      const manufacturingOrderId = scalarToU64(moId)
      const beforeRows = await readOrders()
      const before = exactOrder(beforeRows, manufacturingOrderId, companyId)
      if (!before) throw new Error("Manufacturing order not found")
      if (stateTag(before.state) !== "progress") {
        throw new Error("Manufacturing order must be in Progress state")
      }

      const plannedQty = numeric(before.productQty ?? before.product_qty)
      const producedBefore = numeric(before.qtyProduced ?? before.qty_produced)
      if (plannedQty == null || producedBefore == null) {
        throw new Error("Manufacturing order quantity readback is invalid")
      }
      const remaining = Math.max(0, plannedQty - producedBefore)
      if (qty > remaining + 1e-9) {
        throw new Error(
          `Production quantity ${qty} exceeds remaining quantity ${remaining}`,
        )
      }

      const expectedQty = producedBefore + qty
      const expectedState: "progress" | "toclose" =
        sameQty(expectedQty, plannedQty) ? "toclose" : "progress"

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveManufacturingProductionQuantityEffect(
            await readOrders(),
            manufacturingOrderId,
            companyId,
            expectedQty,
            expectedState,
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "produce_manufacturing_order",
            {
              companyId,
              moId: manufacturingOrderId,
              qtyProducing: qty,
            },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to record manufacturing output",
          )
        },
        afterDispatch: () =>
          refreshResources(qc, organizationId, PRODUCE_AFFECTS),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useFinishManufacturingOrder(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()

  return useMutation<
    ResolvedOperationEffectOutcome<ManufacturingFinishedEffectRef>,
    Error,
    ScalarId
  >({
    mutationFn: async (moId) => {
      if (companyId === 0n) throw new Error("Active company required")
      const manufacturingOrderId = scalarToU64(moId)
      const beforeRows = await readOrders()
      const before = exactOrder(beforeRows, manufacturingOrderId, companyId)
      if (!before) throw new Error("Manufacturing order not found")

      const productId = parseStrictU64(before.productId ?? before.product_id)
      const destinationLocationId = parseStrictU64(
        before.locationDestId ?? before.location_dest_id,
      )
      if (productId == null || destinationLocationId == null) {
        throw new Error("Manufacturing order output relation is invalid")
      }

      if (stateTag(before.state) === "done") {
        const currentQuant = await readDestinationSnapshot(
          companyId,
          productId,
          destinationLocationId,
        )
        const producedQty = numeric(before.qtyProduced ?? before.qty_produced)
        if (producedQty == null) {
          throw new Error("Completed manufacturing order quantity is invalid")
        }
        const existing = await readFinishedEffect(
          manufacturingOrderId,
          companyId,
          {
            id: currentQuant.id,
            quantity: currentQuant.quantity - producedQty,
          },
        )
        if (!existing) {
          throw new Error("Completed manufacturing order has unresolved finished-goods effect")
        }
        return { kind: "already-applied", ref: existing }
      }

      if (stateTag(before.state) !== "toclose") {
        throw new Error("Manufacturing order must be in ToClose state")
      }

      const destinationBefore = await readDestinationSnapshot(
        companyId,
        productId,
        destinationLocationId,
      )

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: () =>
          readFinishedEffect(
            manufacturingOrderId,
            companyId,
            destinationBefore,
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "finish_manufacturing_order",
            { companyId, moId: manufacturingOrderId },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to finish manufacturing order",
          )
        },
        afterDispatch: () =>
          refreshResources(qc, organizationId, FINISH_AFFECTS),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      return requireResolvedOperationEffect(outcome)
    },
  })
}
