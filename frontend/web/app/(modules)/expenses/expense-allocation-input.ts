import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { ExpenseAllocationLineParams } from "@lumiere/stdb/types"

export interface AllocationLookupRow {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  name?: unknown
  code?: unknown
  active?: unknown
}

/** Choices must prove organization/company membership; a missing scope is never a match. */
export function allocationLookupRows<Row extends AllocationLookupRow>(rows: readonly Row[], orgId: bigint, companyId: bigint, activeOnly = false): Row[] {
  if (orgId <= 0n || companyId <= 0n) return []
  return rows.filter((row) => parseStrictU64(row.organizationId ?? row.organization_id) === orgId
    && parseStrictU64(row.companyId ?? row.company_id) === companyId
    && Boolean(parseStrictU64(row.id)) && (!activeOnly || row.active === true))
}

type AllocationInput = { analyticAccountId?: unknown; projectId?: unknown; sharePercent?: unknown; billable?: unknown }

/** Validate the complete replacement before mutation; never silently omit a malformed row or relation. */
export function expenseAllocationLines(value: unknown, projectIds: ReadonlySet<string>, accountIds: ReadonlySet<string>, invalidMessage: string, totalMessage: string): ExpenseAllocationLineParams[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(invalidMessage)
  const lines = value.map((entry): ExpenseAllocationLineParams => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(invalidMessage)
    const row = entry as AllocationInput
    const projectId = allocationId(row.projectId, projectIds, invalidMessage)
    const analyticAccountId = allocationId(row.analyticAccountId, accountIds, invalidMessage)
    const sharePercent = typeof row.sharePercent === "string" && row.sharePercent.trim() !== "" || typeof row.sharePercent === "number"
      ? Number(row.sharePercent) : NaN
    if ((!projectId && !analyticAccountId) || !Number.isFinite(sharePercent) || sharePercent <= 0 || sharePercent > 100 || typeof row.billable !== "boolean") throw new Error(invalidMessage)
    return { analyticAccountId, projectId, sharePercent, billable: row.billable, metadata: undefined }
  })
  const total = lines.reduce((sum, line) => sum + line.sharePercent, 0)
  if (!Number.isFinite(total) || Math.abs(total - 100) > 0.01) throw new Error(totalMessage)
  return lines
}

function allocationId(value: unknown, choices: ReadonlySet<string>, message: string): bigint | undefined {
  if (value == null || value === "") return undefined
  const id = parseStrictU64(value)
  if (!id || !choices.has(String(id))) throw new Error(message)
  return id
}
