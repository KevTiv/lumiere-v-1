"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs"
import { decodeTypedResourceQueryResponse, type ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
import { apiFetch } from "../http"
import { dispatchNamedOperation } from "../operation-dispatch"
import { executeOperationWithCanonicalReadback, requireResolvedOperationEffect, resolveUniqueEffect } from "./operation-effect"
import { invalidateStdbQueryResources, useCompanyScopedTypedQuery } from "./stdb"

type CostResource = "mrp-workcenter-cost-rates" | "mrp-productivity-costs" | "mrp-valuation-configs" | "mrp-production-costs"

export async function readManufacturingCosts<Resource extends CostResource>(resource: Resource, companyId: bigint): Promise<ResourceQueryRowMap[Resource][]> {
  if (companyId <= 0n) throw new Error("Active company required")
  const response = await apiFetch(`/api/query/${resource}?companyId=${encodeURIComponent(String(companyId))}`)
  if (!response.ok) throw Object.assign(new Error(`Failed to read ${resource}`), { status: response.status })
  return decodeTypedResourceQueryResponse(resource, await response.json())
}

function useCostResource<Resource extends CostResource>(resource: Resource, organizationId: bigint) {
  return useCompanyScopedTypedQuery<ResourceQueryRowMap[Resource]>(resource, organizationId, async companyId => {
    const rows = await readManufacturingCosts(resource, companyId)
    return rows.filter(row => row.organizationId === organizationId && row.companyId === companyId)
  })
}

export const useMrpWorkcenterCostRates = (organizationId: bigint) => useCostResource("mrp-workcenter-cost-rates", organizationId)
export const useMrpProductivityCosts = (organizationId: bigint) => useCostResource("mrp-productivity-costs", organizationId)
export const useMrpValuationConfigs = (organizationId: bigint) => useCostResource("mrp-valuation-configs", organizationId)
export const useMrpProductionCosts = (organizationId: bigint) => useCostResource("mrp-production-costs", organizationId)

export function useConfigureWorkcenterCostRate(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Omit<OperationInputMap["configure_workcenter_cost_rate"], "companyId">) => {
      if (companyId <= 0n) throw new Error("Active company required")
      if (!Number.isFinite(params.hourlyRate) || params.hourlyRate < 0) throw new Error("Hourly rate must be a finite, nonnegative amount")
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () => resolveUniqueEffect(
          await readManufacturingCosts("mrp-workcenter-cost-rates", companyId),
          row => row.organizationId === organizationId && row.companyId === companyId && row.workcenterId === params.workcenterId && row.hourlyRate === params.hourlyRate,
          row => ({ resource: "mrp-workcenter-cost-rates", id: String(row.workcenterId) }),
        ),
        dispatch: () => dispatchNamedOperation("configure_workcenter_cost_rate", { companyId, ...params }, "Failed to configure workcenter cost rate"),
        afterDispatch: () => invalidateStdbQueryResources(qc, organizationId, ["mrp-workcenter-cost-rates"]),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useConfigureManufacturingValuation(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: OperationInputMap["configure_manufacturing_valuation"]["params"]) => {
      if (companyId <= 0n) throw new Error("Active company required")
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () => resolveUniqueEffect(
          await readManufacturingCosts("mrp-valuation-configs", companyId),
          row => row.organizationId === organizationId && row.companyId === companyId && row.journalId === params.journalId && row.materialAccountId === params.materialAccountId && row.outputAccountId === params.outputAccountId && row.workcenterAccountId === params.workcenterAccountId && row.varianceAccountId === params.varianceAccountId,
          row => ({ resource: "mrp-valuation-configs", id: String(row.companyId) }),
        ),
        dispatch: () => dispatchNamedOperation("configure_manufacturing_valuation", { companyId, params }, "Failed to configure manufacturing valuation"),
        afterDispatch: () => invalidateStdbQueryResources(qc, organizationId, ["mrp-valuation-configs"]),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}
