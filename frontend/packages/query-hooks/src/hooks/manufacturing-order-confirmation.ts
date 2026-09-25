"use client"

import { decodeOperationDispatch } from "@lumiere/api-client"
import { parseStrictU64, scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { invalidateResourceQueries } from "../subscription-query"
import {
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  resolveUniqueEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

const CONFIRM_AFFECTS = ["mrp-productions", "mrp-workorders"] as const

export interface ManufacturingOrderEffectProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly bomId?: unknown
  readonly bom_id?: unknown
}

export interface ManufacturingOrderEffectRef extends CanonicalRecordRef {
  readonly resource: "mrp-productions"
  readonly companyId: string
  readonly bomId?: string
}

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.toLowerCase()
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
  }
  return String(value).toLowerCase()
}

function requiredRowId(row: ManufacturingOrderEffectProjection): bigint {
  const id = parseStrictU64(row.id)
  if (id == null || id === 0n) {
    throw new Error("Manufacturing-order readback returned an invalid canonical id")
  }
  return id
}

/**
 * Resolve one known manufacturing order only when canonical state confirms the
 * expected transition. The MO primary key is the effect identity; no newest-row
 * or product-based fallback is permitted.
 */
export function resolveManufacturingOrderState(
  rows: readonly ManufacturingOrderEffectProjection[],
  manufacturingOrderId: bigint,
  companyId: bigint,
  expectedState: string,
): ManufacturingOrderEffectRef | null {
  const expected = expectedState.toLowerCase()

  return resolveUniqueEffect(
    rows,
    (row) =>
      parseStrictU64(row.id) === manufacturingOrderId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId &&
      stateTag(row.state) === expected,
    (row) => {
      const id = requiredRowId(row)
      const bomId = parseStrictU64(row.bomId ?? row.bom_id)
      return {
        resource: "mrp-productions",
        id: id.toString(),
        companyId: companyId.toString(),
        ...(bomId == null ? {} : { bomId: bomId.toString() }),
      }
    },
  )
}

async function readManufacturingOrderState(
  manufacturingOrderId: bigint,
  companyId: bigint,
  expectedState: string,
): Promise<ManufacturingOrderEffectRef | null> {
  const rows = await fetchQueryList(
    "/api/query/mrp-productions",
    "Failed to read manufacturing-order result",
  )
  return resolveManufacturingOrderState(
    rows,
    manufacturingOrderId,
    companyId,
    expectedState,
  )
}

async function refreshManufacturing(
  qc: QueryClient,
  organizationId: bigint,
): Promise<void> {
  invalidateResourceQueries(qc, organizationId, CONFIRM_AFFECTS)
  const orgKey = rqBigIntKey(organizationId)
  await Promise.all(
    CONFIRM_AFFECTS.map((resource) =>
      qc.invalidateQueries({ queryKey: [resource, orgKey] }),
    ),
  )
}

/**
 * COV-07a Manufacturing confirmation.
 *
 * Transport acceptance is not success. The mutation resolves only when the
 * same company-scoped MO id reads back as Confirmed. A pre-existing Confirmed
 * state is treated as already-applied and is not redispatched; ambiguous
 * transport outcomes reconcile through bounded exact readback.
 */
export function useConfirmManufacturingOrder(
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
          readManufacturingOrderState(
            manufacturingOrderId,
            companyId,
            "Confirmed",
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "confirm_manufacturing_order",
            {
              companyId,
              moId: manufacturingOrderId,
            },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to confirm manufacturing order",
          )
        },
        afterDispatch: () => refreshManufacturing(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      const resolved = requireResolvedOperationEffect(outcome)
      if (resolved.kind === "already-applied") {
        void refreshManufacturing(qc, organizationId)
      }
      return resolved
    },
  })
}
