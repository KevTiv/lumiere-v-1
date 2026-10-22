export type ApprovalControlRow = {
  id: number | string
  companyId?: number
  company_id?: number
  revision?: number
  instanceRevision?: number
  instance_revision?: number
  status?: unknown
  assignment?: string | { tag?: string }
  actingForOptions?: Array<{ identityHex: string; label: string }>
  directlyEligible?: boolean
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

export type ApprovalActorOption = { identityHex: string; label: string }

/** Accept canonical string, tagged SDK, and single-variant HTTP SQL enums. */
export function approvalTaskStatus(row: { status?: unknown }): string | undefined {
  const raw = row.status
  if (typeof raw === "string") return raw
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as { tag?: unknown; value?: unknown }
  const keys = Object.keys(value)
  if (typeof value.tag === "string") {
    return keys.every((key) => key === "tag" || key === "value") ? value.tag : undefined
  }
  return keys.length === 1 ? keys[0] : undefined
}

function normalizedDelegates(row: ApprovalControlRow): ApprovalActorOption[] {
  const seen = new Set<string>()
  return (row.actingForOptions ?? []).flatMap((option) => {
    const identityHex = option.identityHex.trim().replace(/^0x/i, "").toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(identityHex) || seen.has(identityHex)) return []
    seen.add(identityHex)
    return [{ identityHex, label: option.label.trim() || identityHex }]
  })
}

export function approvalActorOptions(row: ApprovalControlRow): ApprovalActorOption[] {
  return normalizedDelegates(row)
}

/** Resolve a usable principal. Empty string means the current user; null means selection is required. */
export function resolveApprovalActor(row: ApprovalControlRow, requested?: string | null): string | null {
  const delegates = normalizedDelegates(row)
  if (requested != null) {
    const normalized = requested.trim().replace(/^0x/i, "").toLowerCase()
    if (normalized === "") return row.directlyEligible === true ? "" : null
    return delegates.some((option) => option.identityHex === normalized) ? normalized : null
  }
  if (row.directlyEligible === true) return ""
  return delegates.length === 1 ? delegates[0]!.identityHex : null
}

/** Preserve the revisions the operator reviewed; never silently approve a newer task. */
export function approvalSelection(row: ApprovalControlRow, operatingCompanyId: number, actingFor?: string | null): ApprovalSelection {
  const companyId = positiveInteger(row.companyId ?? row.company_id, "Approval company")
  if (companyId !== operatingCompanyId) throw new Error("Approval belongs to another company")
  const status = approvalTaskStatus(row)
  if (status !== "Open" && status !== "Claimed") throw new Error("Approval is no longer pending")
  const actor = resolveApprovalActor(row, actingFor)
  if (actor == null) throw new Error("Select an eligible approval principal")
  const principal = actor || null
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
    now.expectedInstanceRevision !== selection.expectedInstanceRevision ||
    now.actingFor !== selection.actingFor) {
    throw new Error("Approval changed since it was reviewed; refresh the task")
  }
}
