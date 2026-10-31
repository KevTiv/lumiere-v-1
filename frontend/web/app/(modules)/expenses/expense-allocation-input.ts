import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { ExpenseAllocationLineParams } from "@lumiere/stdb/types"
import type { ExpenseAllocationDraft } from "@lumiere/ui/forms/expense-allocation-lines"

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

type AllocationInput = { analyticAccountId?: unknown; projectId?: unknown; sharePercent?: unknown; billable?: unknown; metadata?: unknown }

export interface SavedExpenseAllocationRow extends AllocationLookupRow {
  expenseId?: unknown
  expense_id?: unknown
  analyticAccountId?: unknown
  analytic_account_id?: unknown
  projectId?: unknown
  project_id?: unknown
  sharePercent?: unknown
  share_percent?: unknown
  amount?: unknown
  billable?: unknown
  metadata?: unknown
}

function nullableId(value: unknown, message: string): string {
  if (value === null || value === undefined) return ""
  const id = parseStrictU64(value)
  if (!id) throw new Error(message)
  return String(id)
}

/** A masked, malformed or foreign read is unavailable, never an empty replacement. */
export function savedExpenseAllocationDrafts(rows: readonly SavedExpenseAllocationRow[], organizationId: bigint, companyId: bigint, expenseId: bigint, message: string): ExpenseAllocationDraft[] {
  if (organizationId <= 0n || companyId <= 0n || expenseId <= 0n) throw new Error(message)
  const ids = new Set<string>()
  return rows.map((row) => {
    const id = parseStrictU64(row.id)
    const project = row.projectId ?? row.project_id
    const account = row.analyticAccountId ?? row.analytic_account_id
    const share = row.sharePercent ?? row.share_percent
    if (!id || ids.has(String(id)) || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId
      || parseStrictU64(row.companyId ?? row.company_id) !== companyId
      || parseStrictU64(row.expenseId ?? row.expense_id) !== expenseId
      || !("projectId" in row || "project_id" in row) || !("analyticAccountId" in row || "analytic_account_id" in row)
      || typeof share !== "number" || !Number.isFinite(share) || share <= 0 || share > 100
      || typeof row.amount !== "number" || !Number.isFinite(row.amount)
      || typeof row.billable !== "boolean" || !("metadata" in row)
      || (row.metadata != null && typeof row.metadata !== "string")) throw new Error(message)
    ids.add(String(id))
    const projectId = nullableId(project, message)
    const analyticAccountId = nullableId(account, message)
    if (!projectId && !analyticAccountId) throw new Error(message)
    return { projectId, analyticAccountId, sharePercent: String(share), billable: row.billable,
      ...(typeof row.metadata === "string" ? { metadata: row.metadata } : {}) }
  })
}

/** Includes row identity, amount and metadata, so a fresh server change requires another review. */
export function expenseAllocationFingerprint(rows: readonly SavedExpenseAllocationRow[]): string {
  return JSON.stringify(rows.map((row) => [String(row.id), String(row.expenseId ?? row.expense_id),
    String(row.organizationId ?? row.organization_id), String(row.companyId ?? row.company_id),
    row.projectId ?? row.project_id ?? null, row.analyticAccountId ?? row.analytic_account_id ?? null,
    row.sharePercent ?? row.share_percent, row.amount, row.billable, row.metadata ?? null,
  ].map((value) => typeof value === "bigint" ? String(value) : value)).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

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
    if ((!projectId && !analyticAccountId) || !Number.isFinite(sharePercent) || sharePercent <= 0 || sharePercent > 100 || typeof row.billable !== "boolean"
      || (row.metadata != null && typeof row.metadata !== "string")) throw new Error(invalidMessage)
    return { analyticAccountId, projectId, sharePercent, billable: row.billable, metadata: typeof row.metadata === "string" ? row.metadata : undefined }
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
