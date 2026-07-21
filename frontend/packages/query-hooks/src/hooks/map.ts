"use client"

/**
 * Map hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Map/Fleet module.
 * Fleet vehicles, POS terminals, and warehouse geo data are fetched
 * via the generic query endpoint. Falls back to empty arrays gracefully
 * (the MapClient uses live data only — no silent demo pins).
 */

import { useQuery } from "@tanstack/react-query"

import { fetchQueryListAllowEmpty, type QueryRows } from "../http"

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useFleetVehicles(organizationId: bigint) {
  return useQuery<QueryRows>({
    queryKey: ["fleet-vehicles", organizationId.toString()],
    queryFn: () => fetchQueryListAllowEmpty("/api/query/fleet-vehicles"),
    staleTime: 15_000,
  })
}

export function usePosTerminals(organizationId: bigint) {
  return useQuery<QueryRows>({
    queryKey: ["pos-terminals", organizationId.toString()],
    queryFn: () => fetchQueryListAllowEmpty("/api/query/pos-terminals"),
    staleTime: 30_000,
  })
}

export function useWarehouseGeo(organizationId: bigint) {
  return useQuery<QueryRows>({
    queryKey: ["warehouse-geo", organizationId.toString()],
    queryFn: () => fetchQueryListAllowEmpty("/api/query/warehouse-geo"),
    staleTime: 60_000,
  })
}
