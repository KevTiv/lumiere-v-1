"use client"

/**
 * Fleet hooks — Vehicle and fleet management
 *
 * Wraps REST API calls with React Query for the Fleet module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { fleetBffPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFleetVehicles(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['fleet-vehicles', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/fleet-vehicles', 'Failed to fetch fleet vehicles'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateFleetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return qc.invalidateQueries({ queryKey: ['fleet-vehicles', rqBigIntKey(organizationId)] })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type CreateFleetVehicleInput = {
  name: string
  vehicleType: string
  licensePlate: string | null
  driverName: string | null
}

export function useCreateFleetVehicle(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateFleetVehicleInput>({
    mutationFn: async ({ name, vehicleType, licensePlate, driverName }) => {
      const { urlPath, init } = fleetBffPost("create_fleet_vehicle", [
        organizationId,
        name.trim(),
        vehicleType.trim(),
        licensePlate != null && licensePlate.trim() !== '' ? licensePlate.trim() : null,
        driverName != null && driverName.trim() !== '' ? driverName.trim() : null,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create fleet vehicle')
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

export function useUpdateVehiclePosition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateVehiclePositionInput>({
    mutationFn: async ({ vehicleId, latitude, longitude, speedKmh, heading, status }) => {
      const { urlPath, init } = fleetBffPost("update_vehicle_position", [
        vehicleId,
        latitude,
        longitude,
        speedKmh,
        heading,
        status,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update vehicle position')
    },
    onSuccess: () => invalidateFleetQueries(qc, organizationId),
  })
}
