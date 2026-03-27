/**
 * Map hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Map/Fleet module.
 * Fleet vehicles, POS terminals, and warehouse geo data are fetched
 * via the generic query endpoint. Falls back to empty arrays gracefully
 * (the MapClient uses demo data when arrays are empty).
 */

import { useQuery } from '@tanstack/react-query'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useFleetVehicles(organizationId: bigint) {
  return useQuery({
    queryKey: ['fleet-vehicles', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/fleet-vehicles')
      if (!r.ok) return [] // resource may not exist yet; fall back to demo data
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 15_000,
  })
}

export function usePosTerminals(organizationId: bigint) {
  return useQuery({
    queryKey: ['pos-terminals', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/pos-terminals')
      if (!r.ok) return []
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
  })
}

export function useWarehouseGeo(organizationId: bigint) {
  return useQuery({
    queryKey: ['warehouse-geo', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/warehouses')
      if (!r.ok) return []
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 60_000,
  })
}
