"use client"

/**
 * Fleet hooks — Vehicle and fleet management
 *
 * Wraps REST API calls with React Query for the Fleet module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFleetVehicles(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['fleet-vehicles', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/fleet-vehicles', 'Failed to fetch fleet vehicles'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateFleetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return qc.invalidateQueries({ queryKey: ['fleet-vehicles', organizationId.toString()] })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateFleetVehicle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_fleet_vehicle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create fleet vehicle')
    },
    onSuccess: () => invalidateFleetQueries(qc, organizationId),
  })
}

export function useUpdateVehiclePosition(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      vehicleId: bigint | number | string
      latitude: number
      longitude: number
      speedKmh?: number
      heading?: number
      fuelLevel?: number
      odometerKm?: number
    }) => {
      const r = await apiFetch('/api/call/update_vehicle_position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          args.vehicleId.toString(),
          args.latitude,
          args.longitude,
          args.speedKmh ?? null,
          args.heading ?? null,
          args.fuelLevel ?? null,
          args.odometerKm ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update vehicle position')
    },
    onSuccess: () => invalidateFleetQueries(qc, organizationId),
  })
}
