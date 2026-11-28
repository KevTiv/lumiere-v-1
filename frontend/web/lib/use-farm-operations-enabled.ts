"use client"

import { useErpSession } from "@lumiere/erp-session"
import { useCompanyVerticalPacks } from "@lumiere/query-hooks/hooks/organization-company"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { farmOperationsAccess } from "./farm-operations-access"

export function useFarmOperationsAvailability(companyId: number | null | undefined) {
  const { activeCompanyReady } = useErpSession()
  const { permissionsReady, checkPermission } = useRBAC()
  const canRead = permissionsReady === true && checkPermission("farm_batch", "read").allowed
  const canWriteCompany = permissionsReady === true && checkPermission("company", "write").allowed
  const company = companyId ? BigInt(companyId) : 0n
  const packs = useCompanyVerticalPacks(company, activeCompanyReady === true && canRead)
  const status = farmOperationsAccess({
    companyReady: activeCompanyReady === true,
    companyId: companyId ? String(companyId) : null,
    permissionsReady: permissionsReady === true,
    canRead,
    canWriteCompany,
    packs,
  })
  return { enabled: status === "enabled", status, packs }
}

export function useFarmOperationsEnabled(companyId: number | null | undefined): boolean {
  return useFarmOperationsAvailability(companyId).enabled
}
