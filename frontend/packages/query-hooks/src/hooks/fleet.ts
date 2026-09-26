"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import {
  encodeOptionalString,
  encodeOptionalTimestamp,
  encodeOptionalU64,
  stdbParamsToJson,
} from "@lumiere/stdb/stdb-params-json"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey, type QueryRows } from "../http"
import type { FleetVehicle } from "@lumiere/stdb/types"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFleetVehicles(
  organizationId: bigint,
  initialData?: FleetVehicle[],
) {
  return useQuery({
    queryKey: ["fleet-vehicles", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList("/api/query/fleet-vehicles", "Failed to fetch fleet vehicles"),
    staleTime: 30_000,
    initialData,
  })
}

const fleetHistoryPath = (resource: string) => `/api/query/${resource}`

function useFleetHistory(
  resource: "fleet-service-types" | "fleet-service-records" | "fleet-inspections",
  organizationId: bigint,
) {
  return useQuery<QueryRows>({
    queryKey: [resource, rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList(fleetHistoryPath(resource), `Failed to fetch ${resource}`),
    staleTime: 30_000,
  })
}

export const useFleetServiceTypes = (organizationId: bigint) =>
  useFleetHistory("fleet-service-types", organizationId)

export const useFleetServiceRecords = (organizationId: bigint) =>
  useFleetHistory("fleet-service-records", organizationId)

export const useFleetInspections = (organizationId: bigint) =>
  useFleetHistory("fleet-inspections", organizationId)

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateFleetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return qc.invalidateQueries({ queryKey: ["fleet-vehicles", rqBigIntKey(organizationId)] })
}

function invalidateFleetLifecycleQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const orgKey = rqBigIntKey(organizationId)
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["fleet-vehicles", orgKey] }),
    qc.invalidateQueries({ queryKey: ["fleet-service-records", orgKey] }),
    qc.invalidateQueries({ queryKey: ["fleet-inspections", orgKey] }),
  ])
}

function requireCompany(companyId: bigint | undefined, action: string): bigint {
  if (companyId == null || companyId <= 0n) {
    throw new Error(`Operating company is required to ${action}`)
  }
  return companyId
}

function optionalTimestamp(value?: Date) {
  return encodeOptionalTimestamp(value)
}

function optionalText(value?: string) {
  return encodeOptionalString(value)
}

function optionalNumber(value?: number) {
  return value == null ? { none: [] } : { some: value }
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type CreateFleetVehicleInput = {
  name: string
  vehicleType: string
  licensePlate: string | null
  driverName: string | null
}

export function useCreateFleetVehicle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateFleetVehicleInput>({
    mutationFn: async ({ name, vehicleType, licensePlate, driverName }) => {
      if (companyId == null || companyId <= 0n) {
        throw new Error("Operating company is required to create a fleet vehicle")
      }
      const { urlPath, init } = stdbBffCommandPost("create_fleet_vehicle", { companyId: companyId, params: stdbParamsToJson(
          {
            name: name.trim(),
            vehicleType: vehicleType.trim(),
            licensePlate:
              licensePlate != null && licensePlate.trim() !== "" ? licensePlate.trim() : null,
            driverName:
              driverName != null && driverName.trim() !== "" ? driverName.trim() : null,
            metadata: null,
          },
          "CreateFleetVehicleParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create fleet vehicle")
    },
    onSuccess: () => invalidateFleetQueries(qc, organizationId),
  })
}


export type UpdateVehiclePositionInput = {
  vehicleId: bigint | number | string
  latitude: number
  longitude: number
  speedKmh: number
  heading: number
  status: string
}

export function useUpdateVehiclePosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateVehiclePositionInput>({
    mutationFn: async ({ vehicleId, latitude, longitude, speedKmh, heading, status }) => {
      if (companyId == null || companyId <= 0n) {
        throw new Error("Operating company is required to update vehicle position")
      }
      const { urlPath, init } = stdbBffCommandPost("update_vehicle_position", { companyId: companyId, vehicleId: vehicleId, params: stdbParamsToJson(
          {
            latitude,
            longitude,
            speedKmh,
            heading,
            status,
          },
          "UpdateVehiclePositionParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update vehicle position")
    },
    onSuccess: () => invalidateFleetQueries(qc, organizationId),
  })
}

export interface UpdateFleetVehicleDriverInput {
  vehicleId: bigint
  driverId: bigint | null
}

export function useUpdateFleetVehicleDriver(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateFleetVehicleDriverInput>({
    mutationFn: async ({ vehicleId, driverId }) => {
      const scopedCompanyId = requireCompany(companyId, "update a fleet driver")
      const { urlPath, init } = stdbBffCommandPost("update_fleet_vehicle", {
        companyId: scopedCompanyId,
        vehicleId,
        params: stdbParamsToJson({
          // UpdateFleetVehicleParams uses Option<Option<u64>>: the outer
          // option selects the field, while the inner option assigns/clears it.
          driverId: { some: driverId == null ? { none: [] } : { some: driverId } },
          serviceTypeId: { none: [] },
        }),
      })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error("Failed to update fleet driver")
    },
    onSuccess: () => invalidateFleetLifecycleQueries(qc, organizationId),
  })
}

export interface RecordFleetServiceInput {
  vehicleId: bigint
  serviceTypeId: bigint
  servicedAt?: Date
  odometerKm?: number
  provider?: string
  notes?: string
  clientRequestId?: string
}

export function useRecordFleetService(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, RecordFleetServiceInput>({
    mutationFn: async (input) => {
      const scopedCompanyId = requireCompany(companyId, "record fleet service")
      const { urlPath, init } = stdbBffCommandPost("record_fleet_service", {
        companyId: scopedCompanyId,
        params: stdbParamsToJson({
          vehicleId: input.vehicleId,
          serviceTypeId: input.serviceTypeId,
          servicedAt: optionalTimestamp(input.servicedAt),
          odometerKm: optionalNumber(input.odometerKm),
          provider: optionalText(input.provider),
          notes: optionalText(input.notes),
          clientRequestId: optionalText(input.clientRequestId),
        }),
      })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error("Failed to record fleet service")
    },
    onSuccess: () => invalidateFleetLifecycleQueries(qc, organizationId),
  })
}

export type FleetInspectionOutcome = "passed" | "failed" | "attention_required"

export interface RecordFleetInspectionInput {
  vehicleId: bigint
  inspectorId?: bigint
  inspectedAt?: Date
  outcome: FleetInspectionOutcome
  odometerKm?: number
  notes?: string
  clientRequestId?: string
}

export function useRecordFleetInspection(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, RecordFleetInspectionInput>({
    mutationFn: async (input) => {
      const scopedCompanyId = requireCompany(companyId, "record a fleet inspection")
      const { urlPath, init } = stdbBffCommandPost("record_fleet_inspection", {
        companyId: scopedCompanyId,
        params: stdbParamsToJson({
          vehicleId: input.vehicleId,
          inspectorId: encodeOptionalU64(input.inspectorId),
          inspectedAt: optionalTimestamp(input.inspectedAt),
          outcome: input.outcome,
          odometerKm: optionalNumber(input.odometerKm),
          notes: optionalText(input.notes),
          clientRequestId: optionalText(input.clientRequestId),
        }),
      })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error("Failed to record fleet inspection")
    },
    onSuccess: () => invalidateFleetLifecycleQueries(qc, organizationId),
  })
}
