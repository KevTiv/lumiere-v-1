import type { CompanyVerticalPackRow } from "@lumiere/query-hooks/hooks/organization-company"

export const farmOperationsPackKey = "farm_operations"

export function findFarmOperationsPack(
  rows: readonly CompanyVerticalPackRow[] | undefined,
  companyId: string,
) {
  return rows?.find((row) =>
    String(row.companyId) === companyId && row.packKey === farmOperationsPackKey,
  )
}

export function farmOperationsAccess({
  companyReady,
  companyId,
  permissionsReady,
  canRead,
  canWriteCompany,
  packs,
}: {
  companyReady: boolean
  companyId: string | null
  permissionsReady: boolean
  canRead: boolean
  canWriteCompany: boolean
  packs: {
    isPending: boolean
    isError: boolean
    error?: unknown
    data?: readonly CompanyVerticalPackRow[]
  }
}) {
  if (!companyReady || !permissionsReady) return "loading"
  if (!companyId) return "no-company"
  if (!canRead) return "denied"
  if (packs.isError) {
    const status = packs.error && typeof packs.error === "object" && "status" in packs.error
      ? packs.error.status : undefined
    return status === 401 || status === 403 ? "denied" : "unavailable"
  }
  if (packs.isPending) return "loading"
  if (!packs.data) return "unavailable"
  if (findFarmOperationsPack(packs.data, companyId)?.enabled === true) return "enabled"
  return canWriteCompany ? "setup" : "disabled"
}

export async function updateFarmOperationsSetting({
  companyId,
  enabled,
  save,
  read,
}: {
  companyId: string
  enabled: boolean
  save: () => Promise<unknown>
  read: () => Promise<{ error: unknown; data?: readonly CompanyVerticalPackRow[] }>
}) {
  try {
    await save()
  } catch {
    return "save-error"
  }

  try {
    const result = await read()
    if (!result.error && findFarmOperationsPack(result.data, companyId)?.enabled === enabled) {
      return "verified"
    }
  } catch {
    // A successful command can precede a failed readback.
  }
  return "unverified"
}
