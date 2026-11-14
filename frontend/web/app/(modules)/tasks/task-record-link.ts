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
  const task = row as Record<string, unknown>
  return parseStrictU64(task.id)?.toString() === id
    && parseStrictU64(task.organizationId ?? task.organization_id) === organizationId
    && parseStrictU64(task.companyId ?? task.company_id) === companyId
}
