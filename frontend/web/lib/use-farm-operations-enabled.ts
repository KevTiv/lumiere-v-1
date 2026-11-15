"use client"

import { useCompanyVerticalPacks } from "@lumiere/query-hooks/hooks/organization-company"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"

export function useFarmOperationsAvailability(companyId: number | null | undefined) {
  const { permissionsReady, checkPermission } = useRBAC()
  const canRead = permissionsReady === true && checkPermission("farm_batch", "read").allowed
  const company = companyId ? BigInt(companyId) : 0n
  const packs = useCompanyVerticalPacks(company, canRead)
  const enabled = canRead && !packs.isError &&
    (packs.data?.some((pack) =>
      String(pack.companyId) === String(company) && pack.packKey === "farm_operations" && pack.enabled,
    ) ?? false)
  return { enabled, packs }
}

export function useFarmOperationsEnabled(companyId: number | null | undefined): boolean {
  return useFarmOperationsAvailability(companyId).enabled
}
