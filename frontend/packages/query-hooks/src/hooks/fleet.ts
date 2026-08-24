"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/stdb/stdb-params-json"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
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

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateFleetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return qc.invalidateQueries({ queryKey: ["fleet-vehicles", rqBigIntKey(organizationId)] })
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
