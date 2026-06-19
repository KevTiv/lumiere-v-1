"use client"

import { useMemo } from "react"
import { useErpSession } from "@lumiere/erp-session"

import { resolveActiveErpCompanyId } from "../ai-ui-context"
import { useCompanies } from "./organization-company"

/**
 * Resolve the tenant's operating company (legal entity) for the current org,
 * honoring the global active-company selection when valid.
 */
export function useOperatingCompanyId(organizationId?: number | null): number | null {
  const { companyIds, activeCompanyId, activeCompanyReady } = useErpSession()
  const orgId = organizationId != null && organizationId > 0 ? Math.floor(organizationId) : 0
  const orgReady = orgId > 0
  const companiesQuery = useCompanies(orgId, orgReady)

  return useMemo(
    () =>
      resolveActiveErpCompanyId({
        activeCompanyId: activeCompanyReady ? activeCompanyId : null,
        organizationId: orgId,
        sessionCompanyIds: companyIds,
        companyRows: companiesQuery.data ?? [],
      }),
    [activeCompanyId, activeCompanyReady, companiesQuery.data, companyIds, orgId],
  )
}

/** @deprecated Use {@link useOperatingCompanyId}. Kept for existing module clients. */
export const useDefaultOperatingCompanyId = useOperatingCompanyId

/** BigInt operating company id for reducer/BFF calls. */
export function useOperatingCompanyBigInt(
  organizationId?: number | null,
): bigint | undefined {
  const id = useOperatingCompanyId(organizationId)
  return id != null && id > 0 ? BigInt(id) : undefined
}

/** @deprecated Use {@link useOperatingCompanyBigInt}. Kept for existing module clients. */
export const useDefaultOperatingCompanyBigInt = useOperatingCompanyBigInt
