"use client"

import { decodeOperationDispatch } from "@lumiere/api-client"
import { parseStrictU64, scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { invalidateResourceQueries } from "../subscription-query"
import { resolveManufacturingOrderState, type ManufacturingOrderEffectRef } from "./manufacturing-order-confirmation"
import {
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  resolveUniqueEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

const START_AFFECTS = ["mrp-productions"] as const
const CONSUME_AFFECTS = ["mrp-productions", "stock-moves", "stock-quants"] as const

export interface ManufacturingMaterialOrderProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly bomId?: unknown
  readonly bom_id?: unknown
  readonly productQty?: unknown
  readonly product_qty?: unknown
  readonly locationSrcId?: unknown
  readonly location_src_id?: unknown
  readonly moveRawIds?: unknown
  readonly move_raw_ids?: unknown
  readonly moveRawCount?: unknown
  readonly move_raw_count?: unknown
}

export interface ManufacturingBomLineProjection {
  readonly id?: unknown
  readonly bomId?: unknown
  readonly bom_id?: unknown
  readonly productId?: unknown
  readonly product_id?: unknown
  readonly productQty?: unknown
  readonly product_qty?: unknown
  readonly productUomId?: unknown
  readonly product_uom_id?: unknown
}

export interface ManufacturingStockMoveProjection {
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

export interface ManufacturingMaterialEffectRef extends CanonicalRecordRef {
  readonly resource: "mrp-productions"
  readonly companyId: string
  readonly bomId: string
  readonly stockMoveIds: readonly string[]
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

function sameQty(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9
}

function rowDone(move: ManufacturingStockMoveProjection): boolean {
  const explicit = move.isDone ?? move.is_done
  if (explicit === false) return false
  return stateTag(move.state) === "done"
}

/**
 * Resolve material consumption only from the MO-owned `move_raw_ids` relation.
 * The raw-move set must map one-for-one to the BOM lines with exact product,
 * UOM, quantity, company, production, location, and terminal state semantics.
 * No stock-move scan is allowed to discover "the newest" effect.
 */
export function resolveManufacturingMaterialEffect(
  orders: readonly ManufacturingMaterialOrderProjection[],
  bomLines: readonly ManufacturingBomLineProjection[],
  stockMoves: readonly ManufacturingStockMoveProjection[],
  manufacturingOrderId: bigint,
  companyId: bigint,
): ManufacturingMaterialEffectRef | null {
  const order = resolveUniqueEffect(
    orders,
    (row) =>
      parseStrictU64(row.id) === manufacturingOrderId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId,
    (row) => row,
  )
  if (!order) return null

  const orderState = stateTag(order.state)
  if (orderState !== "progress" && orderState !== "toclose") return null

  const bomId = parseStrictU64(order.bomId ?? order.bom_id)
  const sourceLocationId = parseStrictU64(order.locationSrcId ?? order.location_src_id)
  const orderQty = numeric(order.productQty ?? order.product_qty)
  const rawMoveIds = parseIdList(order.moveRawIds ?? order.move_raw_ids)
  const rawMoveCount = numeric(order.moveRawCount ?? order.move_raw_count)
  if (
    bomId == null ||
    sourceLocationId == null ||
    orderQty == null ||
    rawMoveIds == null ||
    rawMoveIds.length === 0 ||
    rawMoveCount == null ||
    rawMoveCount !== rawMoveIds.length
  ) {
    return null
  }

  if (new Set(rawMoveIds.map(String)).size !== rawMoveIds.length) return null

  const lines = bomLines.filter(
    (line) => parseStrictU64(line.bomId ?? line.bom_id) === bomId,
  )
  if (lines.length === 0 || lines.length !== rawMoveIds.length) return null

  const rawMoves = rawMoveIds.map((moveId) => {
    const matches = stockMoves.filter((move) => parseStrictU64(move.id) === moveId)
    return matches.length === 1 ? matches[0]! : null
  })
  if (rawMoves.some((move) => move == null)) return null

  const unmatched = [...(rawMoves as ManufacturingStockMoveProjection[])]
  for (const line of lines) {
    const productId = parseStrictU64(line.productId ?? line.product_id)
    const productUomId = parseStrictU64(line.productUomId ?? line.product_uom_id)
    const lineQty = numeric(line.productQty ?? line.product_qty)
    if (productId == null || productUomId == null || lineQty == null) return null

    const requiredQty = lineQty * Math.max(orderQty, 1)
    const index = unmatched.findIndex((move) => {
      const moveQty = numeric(move.productUomQty ?? move.product_uom_qty)
      const quantityDone = numeric(move.quantityDone ?? move.quantity_done)
      return (
        parseStrictU64(move.companyId ?? move.company_id) === companyId &&
        parseStrictU64(move.productionId ?? move.production_id) === manufacturingOrderId &&
        parseStrictU64(move.productId ?? move.product_id) === productId &&
        parseStrictU64(move.productUom ?? move.product_uom) === productUomId &&
        parseStrictU64(move.locationId ?? move.location_id) === sourceLocationId &&
        parseStrictU64(move.locationDestId ?? move.location_dest_id) === sourceLocationId &&
        moveQty != null &&
        quantityDone != null &&
        sameQty(moveQty, requiredQty) &&
        sameQty(quantityDone, requiredQty) &&
        rowDone(move)
      )
    })
    if (index < 0) return null
    unmatched.splice(index, 1)
  }
  if (unmatched.length !== 0) return null

  return {
    resource: "mrp-productions",
    id: manufacturingOrderId.toString(),
    companyId: companyId.toString(),
    bomId: bomId.toString(),
    stockMoveIds: rawMoveIds.map(String),
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

async function readOrderState(
  manufacturingOrderId: bigint,
  companyId: bigint,
  expectedState: string,
): Promise<ManufacturingOrderEffectRef | null> {
  const orders = await fetchQueryList(
    "/api/query/mrp-productions",
    "Failed to read manufacturing-order result",
  )
  return resolveManufacturingOrderState(
    orders,
    manufacturingOrderId,
    companyId,
    expectedState,
  )
}

async function readMaterialEffect(
  manufacturingOrderId: bigint,
  companyId: bigint,
): Promise<ManufacturingMaterialEffectRef | null> {
  const [orders, bomLines, stockMoves] = await Promise.all([
    fetchQueryList(
      "/api/query/mrp-productions",
      "Failed to read manufacturing-order result",
    ),
    fetchQueryList(
      "/api/query/mrp-bom-lines",
      "Failed to read manufacturing BOM lines",
    ),
    fetchQueryList(
      "/api/query/stock-moves",
      "Failed to read manufacturing stock moves",
    ),
  ])

  return resolveManufacturingMaterialEffect(
    orders,
    bomLines,
    stockMoves,
    manufacturingOrderId,
    companyId,
  )
}

export function useStartManufacturingOrder(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()

  return useMutation<
    ResolvedOperationEffectOutcome<ManufacturingOrderEffectRef>,
    Error,
    ScalarId
  >({
    mutationFn: async (productionId) => {
      if (companyId === 0n) throw new Error("Active company required")
      const manufacturingOrderId = scalarToU64(productionId)
      if (manufacturingOrderId === 0n) {
        throw new Error("Manufacturing order id required")
      }

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: () =>
          readOrderState(manufacturingOrderId, companyId, "Progress"),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "start_manufacturing_order",
            { companyId, moId: manufacturingOrderId },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to start manufacturing order",
          )
        },
        afterDispatch: () =>
          refreshResources(qc, organizationId, START_AFFECTS),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      const resolved = requireResolvedOperationEffect(outcome)
      if (resolved.kind === "already-applied") {
        void refreshResources(qc, organizationId, START_AFFECTS)
      }
      return resolved
    },
  })
}

export function useConsumeMoMaterials(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()

  return useMutation<
    ResolvedOperationEffectOutcome<ManufacturingMaterialEffectRef>,
    Error,
    ScalarId
  >({
    mutationFn: async (productionId) => {
      if (companyId === 0n) throw new Error("Active company required")
      const manufacturingOrderId = scalarToU64(productionId)
      if (manufacturingOrderId === 0n) {
        throw new Error("Manufacturing order id required")
      }

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: () =>
          readMaterialEffect(manufacturingOrderId, companyId),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "consume_mo_materials",
            { companyId, moId: manufacturingOrderId },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to consume manufacturing materials",
          )
        },
        afterDispatch: () =>
          refreshResources(qc, organizationId, CONSUME_AFFECTS),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      const resolved = requireResolvedOperationEffect(outcome)
      if (resolved.kind === "already-applied") {
        void refreshResources(qc, organizationId, CONSUME_AFFECTS)
      }
      return resolved
    },
  })
}
