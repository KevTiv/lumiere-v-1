export type ApprovalControlRow = {
  id: number | string
  companyId?: number
  company_id?: number
  revision?: number
  instanceRevision?: number
  instance_revision?: number
  status?: string | { tag?: string }
  assignment?: string | { tag?: string }
  actingForOptions?: Array<{ identityHex: string; label: string }>
}

export type ApprovalSelection = {
  requestId: number
  companyId: number
  expectedTaskRevision: number
  expectedInstanceRevision: number
  actingFor?: string | null
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} is unavailable`)
  return number
}

/** Preserve the revisions the operator reviewed; never silently approve a newer task. */
export function approvalSelection(row: ApprovalControlRow, operatingCompanyId: number, actingFor?: string | null): ApprovalSelection {
  const companyId = positiveInteger(row.companyId ?? row.company_id, "Approval company")
  if (companyId !== operatingCompanyId) throw new Error("Approval belongs to another company")
  const status = typeof row.status === "string" ? row.status : row.status?.tag
  if (status !== "Open" && status !== "Claimed") throw new Error("Approval is no longer pending")
  const principal = actingFor?.trim().replace(/^0x/i, "").toLowerCase() || null
  if (principal && (!/^[0-9a-f]{64}$/.test(principal) ||
    !row.actingForOptions?.some((option) => option.identityHex.toLowerCase() === principal))) {
    throw new Error("Delegated approval is unavailable; refresh the task")
  }
  return {
    requestId: positiveInteger(row.id, "Approval task"),
    companyId,
    expectedTaskRevision: positiveInteger(row.revision, "Approval revision"),
    expectedInstanceRevision: positiveInteger(row.instanceRevision ?? row.instance_revision, "Workflow revision"),
    actingFor: principal,
  }
}

export function requireUnchangedApproval(selection: ApprovalSelection, current: ApprovalControlRow): void {
  const now = approvalSelection(current, selection.companyId, selection.actingFor)
  if (now.requestId !== selection.requestId || now.expectedTaskRevision !== selection.expectedTaskRevision ||
    now.expectedInstanceRevision !== selection.expectedInstanceRevision) {
    throw new Error("Approval changed since it was reviewed; refresh the task")
  }
}
