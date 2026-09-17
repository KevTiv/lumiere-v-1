"use client"

import { decodeOperationDispatch } from "@lumiere/api-client"
import { parseStrictU64, scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type { ConvertOpportunityParams } from "@lumiere/stdb/types"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList } from "../http"
import { invalidateResourceQueries } from "../subscription-query"
import {
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  resolveUniqueEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

export interface SaleOrderEffectProjection {
  readonly id?: unknown
  readonly opportunityId?: unknown
  readonly opportunity_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
}

export interface SaleOrderEffectRef extends CanonicalRecordRef {
  readonly resource: "sale-orders"
  readonly opportunityId: string
  readonly companyId: string
}

function requiredRowId(row: SaleOrderEffectProjection): bigint {
  const id = parseStrictU64(row.id)
  if (id == null || id === 0n) {
    throw new Error("Sale-order readback returned an invalid canonical id")
  }
  return id
}

/**
 * Resolve the unique sale order created for an opportunity in the selected
 * company. This is the canonical effect identity for CRM → Sales conversion.
 * Multiple matches are an invariant failure; never choose the newest row.
 */
export function resolveSaleOrderForOpportunity(
  rows: readonly SaleOrderEffectProjection[],
  opportunityId: bigint,
  companyId: bigint,
): SaleOrderEffectRef | null {
  return resolveUniqueEffect(
    rows,
    (row) => {
      const rowOpportunityId = parseStrictU64(
        row.opportunityId ?? row.opportunity_id,
      )
      const rowCompanyId = parseStrictU64(row.companyId ?? row.company_id)
      return rowOpportunityId === opportunityId && rowCompanyId === companyId
    },
    (row) => {
      const id = requiredRowId(row)
      return {
        resource: "sale-orders",
        id: id.toString(),
        href: `/sales?orderId=${encodeURIComponent(id.toString())}`,
        opportunityId: opportunityId.toString(),
        companyId: companyId.toString(),
      }
    },
  )
}

async function readSaleOrderEffect(
  opportunityId: bigint,
  companyId: bigint,
): Promise<SaleOrderEffectRef | null> {
  const rows = await fetchQueryList(
    "/api/query/sale-orders",
    "Failed to read sale-order conversion result",
  )
  return resolveSaleOrderForOpportunity(rows, opportunityId, companyId)
}

/**
 * COV-01b reference migration for CRM opportunity → sale order.
 *
 * The public mutation resolves only after canonical state proves the intended
 * sale order exists. Transport acceptance alone is insufficient. Ambiguous
 * dispatch is reconciled by readback and never redispatched.
 */
export function useConvertOpportunityToSaleOrder(
  organizationId: bigint,
  options?: { companyId?: bigint },
) {
  const qc = useQueryClient()
  const defaultCompanyId = options?.companyId

  return useMutation<
    ResolvedOperationEffectOutcome<SaleOrderEffectRef>,
    Error,
    {
      opportunityId: ScalarId
      params: ConvertOpportunityParams
      companyId?: ScalarId
    }
  >({
    mutationFn: async ({ opportunityId, params, companyId }) => {
      const scopedCompanyId =
        companyId != null ? scalarToU64(companyId) : defaultCompanyId
      if (scopedCompanyId == null || scopedCompanyId === 0n) {
        throw new Error("Company scope required to convert opportunity")
      }

      const canonicalOpportunityId = scalarToU64(opportunityId)
      if (canonicalOpportunityId === 0n) {
        throw new Error("Opportunity id required to convert opportunity")
      }

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: () =>
          readSaleOrderEffect(canonicalOpportunityId, scopedCompanyId),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "convert_opportunity_to_sale_order",
            {
              companyId: scopedCompanyId,
              opportunityId: canonicalOpportunityId,
              params: stdbParamsToJson(params, "ConvertOpportunityParams"),
            },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to convert opportunity to sale order",
          )
        },
        afterDispatch: async () => {
          await Promise.all([
            invalidateResourceQueries(qc, organizationId, ["opportunities"]),
            invalidateResourceQueries(qc, organizationId, ["sale-orders"]),
          ])
        },
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      const resolved = requireResolvedOperationEffect(outcome)
      if (resolved.kind === "already-applied") {
        // Replay/pre-existing effect: refresh the UI opportunistically without
        // turning cache housekeeping into business-effect failure.
        void invalidateResourceQueries(qc, organizationId, ["opportunities"])
        void invalidateResourceQueries(qc, organizationId, ["sale-orders"])
      }
      return resolved
    },
  })
}
