import type { ErpSessionState } from "@lumiere/erp-session"

import { fetchQueryList, fetchQueryListState, rqBigIntKey } from "../../http"

type CompanyScope = Pick<ErpSessionState, "activeCompanyId" | "activeCompanyReady">
type HrReadResource =
  | "hr-leave-allocations"
  | "hr-offboarding-checklists"
  | "hr-statutory-ids"

function companyReadOptions<T>(
  resource: HrReadResource,
  organizationId: bigint,
  { activeCompanyId, activeCompanyReady }: CompanyScope,
  loadRows: (path: string) => Promise<T>,
) {
  // A not-ready session must not expose the previous company's cached rows.
  const companyId = activeCompanyReady ? (activeCompanyId ?? null) : null
  const enabled = organizationId > 0n && activeCompanyReady === true && companyId != null && companyId > 0
  return {
    queryKey: [resource, rqBigIntKey(organizationId), "company", companyId] as const,
    queryFn: () => {
      // Also fail closed on manual refetch, which bypasses `enabled`.
      if (!enabled) {
        throw new Error(`An active company and organization are required to query ${resource}`)
      }
      // Dynamic paths preserve tolerant rows when the installed contracts lag the server.
      const path: string = `/api/query/${resource}?companyId=${encodeURIComponent(String(companyId))}`
      return loadRows(path)
    },
    enabled,
    staleTime: 30_000,
  }
}

export function leaveAllocationsQueryOptions(organizationId: bigint, scope: CompanyScope) {
  return companyReadOptions("hr-leave-allocations", organizationId, scope, (path) =>
    fetchQueryList(path, "Failed to fetch leave allocations"),
  )
}

export function offboardingChecklistsQueryOptions(organizationId: bigint, scope: CompanyScope) {
  return companyReadOptions("hr-offboarding-checklists", organizationId, scope, fetchQueryListState)
}

export function statutoryIdsQueryOptions(organizationId: bigint, scope: CompanyScope) {
  return companyReadOptions("hr-statutory-ids", organizationId, scope, fetchQueryListState)
}
