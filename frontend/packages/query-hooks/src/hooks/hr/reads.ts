"use client"

import { useQuery } from "@tanstack/react-query"
import { fetchQueryList, fetchQueryListState, type QueryRows, rqBigIntKey } from "../../http"

// Plain `string` paths on purpose: these resources' generated row types may be newer than the
// installed contracts, so rows are read through tolerant getters (see ../hr-allocations).
const ALLOCATIONS_PATH: string = "/api/query/hr-leave-allocations"
const OFFBOARDING_PATH: string = "/api/query/hr-offboarding-checklists"
const STATUTORY_IDS_PATH: string = "/api/query/hr-statutory-ids"

export function useLeaveAllocations(organizationId: bigint) {
  return useQuery<QueryRows>({
    queryKey: ["hr-leave-allocations", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList(ALLOCATIONS_PATH, "Failed to fetch leave allocations"),
    staleTime: 30_000,
  })
}

/** State-aware read: `status: "denied"` means the user may not read the resource (hide the UI). */
export function useOffboardingChecklists(organizationId: bigint) {
  return useQuery({
    queryKey: ["hr-offboarding-checklists", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryListState(OFFBOARDING_PATH),
    staleTime: 30_000,
  })
}

/**
 * PII: the server omits the identifier `value` column unless the user holds
 * hr_employee/view_statutory_id. `status: "denied"` means no read permission at all.
 */
export function useStatutoryIds(organizationId: bigint) {
  return useQuery({
    queryKey: ["hr-statutory-ids", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryListState(STATUTORY_IDS_PATH),
    staleTime: 30_000,
  })
}
