"use client"

import { useErpSession } from "@lumiere/erp-session"
import { useQuery } from "@tanstack/react-query"

import {
  leaveAllocationsQueryOptions,
  offboardingChecklistsQueryOptions,
  statutoryIdsQueryOptions,
} from "./reads-options"

export function useLeaveAllocations(organizationId: bigint) {
  const { activeCompanyId, activeCompanyReady } = useErpSession()
  return useQuery(leaveAllocationsQueryOptions(organizationId, { activeCompanyId, activeCompanyReady }))
}

/** State-aware read: `status: "denied"` means the user may not read the resource (hide the UI). */
export function useOffboardingChecklists(organizationId: bigint) {
  const { activeCompanyId, activeCompanyReady } = useErpSession()
  return useQuery(offboardingChecklistsQueryOptions(organizationId, { activeCompanyId, activeCompanyReady }))
}

/**
 * PII: the server omits the identifier `value` column unless the user holds
 * hr_employee/view_statutory_id. `status: "denied"` means no read permission at all.
 */
export function useStatutoryIds(organizationId: bigint) {
  const { activeCompanyId, activeCompanyReady } = useErpSession()
  return useQuery(statutoryIdsQueryOptions(organizationId, { activeCompanyId, activeCompanyReady }))
}
