"use client"

import { useMemo } from "react"
import { useErpSession } from "@lumiere/erp-session"

import { resolveErpCompanyId } from "../ai-ui-context"
import { useCompanies } from "./organization-company"

/**
 * Resolve the tenant's default operating company (legal entity) for the current org.
 * Never aliases `organizationId` — returns null when no company row exists yet.
 */
export function useDefaultOperatingCompanyId(organizationId?: number | null): number | null {
  const { companyIds } = useErpSession()
  const orgId = organizationId != null && organizationId > 0 ? Math.floor(organizationId) : 0
  const orgReady = orgId > 0
  const companiesQuery = useCompanies(orgId, orgReady)

  return useMemo(
    () =>
      resolveErpCompanyId({
        organizationId: orgId,
        sessionCompanyIds: companyIds,
        companyRows: companiesQuery.data ?? [],
      }),
    [companiesQuery.data, companyIds, orgId],
  )
}

/** BigInt operating company id for reducer/BFF calls. */
export function useDefaultOperatingCompanyBigInt(
  organizationId?: number | null,
): bigint | undefined {
  const id = useDefaultOperatingCompanyId(organizationId)
  return id != null && id > 0 ? BigInt(id) : undefined
}
