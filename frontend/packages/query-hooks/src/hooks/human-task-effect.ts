import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

type HumanTaskTag =
  | "AllCandidates"
  | "AnyCandidate"
  | "Approve"
  | "Approved"
  | "Claimed"
  | "Complete"
  | "Completed"
  | "Open"
  | "Reject"
  | "Rejected"

type Tagged =
  | string
  | Readonly<{ tag?: string } & Partial<Record<HumanTaskTag, readonly unknown[]>>>
  | null
  | undefined

export type HumanTaskEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly status?: Tagged
  readonly decision?: Tagged
  readonly assignment?: Tagged
  readonly revision?: unknown
  readonly claimedBy?: unknown
  readonly claimed_by?: unknown
  readonly decidedBy?: unknown
  readonly decided_by?: unknown
}

function tag(value: Tagged): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    if ("tag" in value && typeof value.tag === "string") return value.tag
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!
  }
  return ""
}

function exactTask(
  rows: readonly HumanTaskEffectProjection[],
  organizationId: bigint,
  taskId: bigint,
): HumanTaskEffectProjection | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === taskId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one human task, found ${matches.length}`)
  }
  const row = matches[0]
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  return row
}

const ref = (taskId: bigint): CanonicalRecordRef => ({
  resource: "workflow-human-tasks",
  id: taskId.toString(),
})

/**
 * COV-21: a claim is proven when the exact task reads back Claimed, with a
 * claimant, at exactly the next revision.
 */
export function resolveHumanTaskClaimEffect(
  rows: readonly HumanTaskEffectProjection[],
  organizationId: bigint,
  taskId: bigint,
  expectedRevision: number,
): CanonicalRecordRef | null {
  const row = exactTask(rows, organizationId, taskId)
  if (!row) return null
  if (tag(row.status) !== "Claimed" || (row.claimedBy ?? row.claimed_by ?? null) == null) return null
  return Number(row.revision) === expectedRevision + 1 ? ref(taskId) : null
}

const TERMINAL_STATUS: Record<string, string> = {
  Approve: "Approved",
  Reject: "Rejected",
  Complete: "Completed",
}

/**
 * COV-21: a decision is proven when the exact task reads back terminal with the
 * requested decision and a decider. An all-candidates task that recorded this
 * vote without reaching quorum stays open but advances its revision.
 */
export function resolveHumanTaskDecisionEffect(
  rows: readonly HumanTaskEffectProjection[],
  organizationId: bigint,
  taskId: bigint,
  decision: "Approve" | "Reject" | "Complete",
  expectedTaskRevision: number,
): CanonicalRecordRef | null {
  const row = exactTask(rows, organizationId, taskId)
  if (!row) return null
  const decided =
    tag(row.decision) === decision &&
    tag(row.status) === TERMINAL_STATUS[decision] &&
    (row.decidedBy ?? row.decided_by ?? null) != null
  if (decided) return ref(taskId)
  const partialVote =
    tag(row.assignment) === "AllCandidates" &&
    ["Open", "Claimed"].includes(tag(row.status)) &&
    Number(row.revision) > expectedTaskRevision
  return partialVote ? ref(taskId) : null
}
