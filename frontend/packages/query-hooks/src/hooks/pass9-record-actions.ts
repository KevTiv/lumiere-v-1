"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { stdbParamsToJson } from "@lumiere/stdb/stdb-params-json"
import type { UpdateStockPickingParams } from "@lumiere/stdb/types"
import { fetchQueryList, rqBigIntKey } from "../http"
import { dispatchNamedOperation } from "../operation-dispatch"
import { executeOperationWithCanonicalReadback, requireResolvedOperationEffect, resolveUniqueRow, type CanonicalRecordRef, type ExecuteOperationWithReadbackArgs } from "./operation-effect"

/** Canonical query projections can carry either wire or generated field spelling. */
export function recordField(row: object, key: string): unknown {
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  return Reflect.get(row, key) ?? Reflect.get(row, snake)
}

export function resolveUpdatedRecord(
  rows: readonly object[], id: bigint, companyId: bigint | undefined,
  resource: string, matches: (row: object) => boolean,
): CanonicalRecordRef | null {
  const row = resolveUniqueRow(rows, (candidate) => String(recordField(candidate, "id")) === String(id))
  if (!row || (companyId != null && String(recordField(row, "companyId")) !== String(companyId)) || !matches(row)) return null
  return { resource, id: String(id) }
}

const option = (value: unknown) => value == null ? { none: [] } : { some: value }
// The outer option expresses patch presence; the inner option explicitly clears a value.
const patchOption = (value: unknown) => value === undefined ? option(undefined) : { some: option(value) }

export interface ManufacturingHeaderPatch {
  productQty: number
}
export interface FleetDetailsPatch {
  name: string
  vehicleType: string
  licensePlate: string | null
  driverName: string | null
  odometerKm: number | null
  fuelLevel: number | null
}

export function fleetDetailsParams(patch: FleetDetailsPatch) {
  return stdbParamsToJson({
    name: option(patch.name.trim()), vehicleType: option(patch.vehicleType.trim()),
    licensePlate: patchOption(patch.licensePlate), driverName: patchOption(patch.driverName),
    odometerKm: patchOption(patch.odometerKm), fuelLevel: patchOption(patch.fuelLevel),
    metadata: option(undefined),
  })
}

export function pickingHeaderParams(companyId: bigint, patch: Pick<UpdateStockPickingParams, "origin" | "note">) {
  return stdbParamsToJson({
    companyId: option(companyId), partnerId: option(undefined), scheduledDate: option(undefined),
    origin: option(patch.origin), note: option(patch.note),
  })
}

function useRecordMutation<Input>(organizationId: bigint, resources: readonly string[], execute: (input: Input) => Omit<ExecuteOperationWithReadbackArgs<CanonicalRecordRef>, "afterDispatch">) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Input) => requireResolvedOperationEffect(await executeOperationWithCanonicalReadback({
      ...execute(input),
      resolveBeforeDispatch: false,
      afterDispatch: async () => {
        await Promise.all(resources.map((resource) => qc.invalidateQueries({ queryKey: [resource, rqBigIntKey(organizationId)] })))
      },
    })),
  })
}

function requireCompany(companyId?: bigint): bigint {
  if (companyId == null || companyId <= 0n) throw new Error("Operating company is required")
  return companyId
}

export function useUnreservePicking(organizationId: bigint, companyId?: bigint) {
  return useRecordMutation(organizationId, ["stock-pickings", "stock-moves", "stock-quants", "stock-production-serials"], (pickingId: bigint) => {
    const company = requireCompany(companyId)
    return {
      dispatch: () => dispatchNamedOperation("unreserve_stock_picking", { pickingId, params: stdbParamsToJson({ companyId: option(company) }) }, "Failed to release reservation"),
      resolveEffect: async () => resolveUpdatedRecord(await fetchQueryList("/api/query/stock-pickings", "Failed to read transfer"), pickingId, company, "stock-pickings", (row) => recordField(row, "state") === "confirmed"),
    }
  })
}

export function useUpdatePickingHeader(organizationId: bigint, companyId?: bigint) {
  return useRecordMutation(organizationId, ["stock-pickings"], ({ pickingId, origin, note }: { pickingId: bigint; origin: string; note: string }) => {
    const company = requireCompany(companyId)
    return {
      dispatch: () => dispatchNamedOperation("update_stock_picking", { pickingId, params: pickingHeaderParams(company, { origin, note }) }, "Failed to edit transfer"),
      resolveEffect: async () => resolveUpdatedRecord(await fetchQueryList("/api/query/stock-pickings", "Failed to read transfer"), pickingId, company, "stock-pickings", (row) => recordField(row, "origin") === origin && recordField(row, "note") === note),
    }
  })
}

export function useUpdateManufacturingHeader(organizationId: bigint, companyId?: bigint) {
  return useRecordMutation(organizationId, ["mrp-productions"], ({ moId, productQty }: ManufacturingHeaderPatch & { moId: bigint }) => {
    const company = requireCompany(companyId)
    return {
      dispatch: () => dispatchNamedOperation("update_manufacturing_order", { companyId: company, moId, params: stdbParamsToJson({ productQty: option(productQty), datePlannedStart: option(undefined), datePlannedFinished: option(undefined), dateDeadline: option(undefined), origin: option(undefined), metadata: option(undefined) }) }, "Failed to edit manufacturing order"),
      resolveEffect: async () => resolveUpdatedRecord(await fetchQueryList("/api/query/mrp-productions", "Failed to read manufacturing order"), moId, company, "mrp-productions", (row) => Number(recordField(row, "productQty")) === productQty),
    }
  })
}

export function useUpdateFleetDetails(organizationId: bigint, companyId?: bigint) {
  return useRecordMutation(organizationId, ["fleet-vehicles"], ({ vehicleId, ...patch }: FleetDetailsPatch & { vehicleId: bigint }) => {
    const company = requireCompany(companyId)
    const expected = { ...patch, name: patch.name.trim(), vehicleType: patch.vehicleType.trim() }
    return {
      dispatch: () => dispatchNamedOperation("update_fleet_vehicle_details", { companyId: company, vehicleId, params: fleetDetailsParams(patch) }, "Failed to edit vehicle"),
      resolveEffect: async () => resolveUpdatedRecord(await fetchQueryList("/api/query/fleet-vehicles", "Failed to read vehicle"), vehicleId, company, "fleet-vehicles", (row) => Object.entries(expected).every(([key, value]) => (recordField(row, key) ?? null) === value)),
    }
  })
}

export function useResetAccountMoveToDraft(organizationId: bigint) {
  return useRecordMutation(organizationId, ["account-moves", "account-move-lines"], (moveId: bigint) => ({
    dispatch: () => dispatchNamedOperation("reset_account_move_to_draft", { moveId }, "Failed to reset document"),
    resolveEffect: async () => resolveUpdatedRecord(await fetchQueryList("/api/query/account-moves", "Failed to read document"), moveId, undefined, "account-moves", (row) => {
      const state = recordField(row, "state")
      return (state === "Draft" || (typeof state === "object" && state != null && Reflect.get(state, "tag") === "Draft")) && recordField(row, "postedBefore") === false
    }),
  }))
}
