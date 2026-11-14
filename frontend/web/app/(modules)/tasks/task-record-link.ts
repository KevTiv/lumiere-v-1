import { parseAssistantActionId } from "@lumiere/query-hooks/assistant-actions"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

export type TaskRecordLink = {
  id?: string
  companyId?: string
  view?: "edit" | "assign"
}

export function taskRecordTarget(link: TaskRecordLink | undefined, activeCompanyId: bigint): string | undefined {
  return activeCompanyId > 0n && link?.companyId === String(activeCompanyId)
    ? parseAssistantActionId(link.id)
    : undefined
}

export function matchesTaskRecord(row: unknown, id: string, organizationId: bigint, companyId: bigint): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false
  const organization = "organizationId" in row ? row.organizationId : undefined
  const company = "companyId" in row ? row.companyId : undefined
  return "id" in row && parseStrictU64(row.id)?.toString() === id
    && parseStrictU64(organization ?? ("organization_id" in row ? row.organization_id : undefined)) === organizationId
    && parseStrictU64(company ?? ("company_id" in row ? row.company_id : undefined)) === companyId
}
