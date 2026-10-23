import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { ClaimHumanTaskInput, DecideHumanTaskInput, ResubmitHumanTaskInput } from "./approvals"
import { approvalTaskStatus } from "./approval-controls"
import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"
import { parseWorkBoardPage, workBoardQueryPath, type WorkBoardScope } from "./work-board-model"

/** One user-confirmed attempt. Reconciliation must retain these keys and inputs. */
export interface HumanTaskCommandAttempt {
  readonly idempotencyKey: string
  readonly correlationId: string
}

export function newHumanTaskAttempt(kind: "claim" | "decision" | "resubmit"): HumanTaskCommandAttempt {
  return Object.freeze({
    idempotencyKey: `${kind}-${crypto.randomUUID()}`,
    correlationId: `corr-${crypto.randomUUID()}`,
  })
}

interface HumanTaskCommandScope {
  readonly organizationId: string
  readonly companyId: string
  readonly taskId: string
  readonly actorIdentityHex: string
  readonly actingForIdentityHex: string | null
  readonly idempotencyKey: string
  readonly inputHash: string
  readonly priorRevision: string
}

export type HumanTaskCommandExpectation = HumanTaskCommandScope & (
  | {
    readonly commandKind: "claim" | "decision"
    readonly decision: "approve" | "reject" | "complete" | null
  }
  | {
    readonly commandKind: "resubmit"
    readonly decision: null
    readonly priorInstanceRevision: string
    readonly subjectRevisionHash: string
  }
)

const identity = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Workflow actor identity is unavailable")
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error("Invalid workflow actor identity")
  return normalized
}

const positive = (value: number, label: string): string => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`)
  return String(value)
}

function commandKey(value: string): string {
  if (!value.trim() || /\p{Cc}/u.test(value) || new TextEncoder().encode(value).length > 256) {
    throw new Error("Invalid workflow command key")
  }
  return value
}

/** Rust str::trim uses Unicode White_Space (different from JavaScript trim). */
export function normalizeHumanTaskComment(comment?: string | null): string {
  const normalized = (comment ?? "").replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")
  if (new TextEncoder().encode(normalized).length > 8192) throw new Error("Workflow comment exceeds 8192 bytes")
  return normalized
}

export function normalizeHumanTaskResubmissionReason(reason: string): string {
  const normalized = normalizeHumanTaskComment(reason)
  if (!normalized) throw new Error("A reason is required to resubmit this approval")
  return normalized
}

/** Matches native hash_fields: UTF-8 fields, each prefixed by an eight-byte BE length. */
export async function humanTaskInputHash(fields: readonly string[]): Promise<string> {
  const encoded = fields.map((field) => new TextEncoder().encode(field))
  const bytes = new Uint8Array(encoded.reduce((length, field) => length + 8 + field.length, 0))
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (const field of encoded) {
    view.setBigUint64(offset, BigInt(field.length), false)
    bytes.set(field, offset + 8)
    offset += 8 + field.length
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function baseExpectation(
  scope: WorkBoardScope,
  input: Pick<ClaimHumanTaskInput, "companyId" | "taskId" | "attempt" | "actingFor">,
) {
  // Validate the full scope before using it for a command or exact readback.
  workBoardQueryPath(scope)
  if (input.companyId !== scope.companyId) throw new Error("Workflow command belongs to another company")
  if (!input.attempt) throw new Error("Workflow command attempt is unavailable")
  commandKey(input.attempt.correlationId)
  return {
    organizationId: positive(scope.organizationId, "organization"),
    companyId: positive(input.companyId, "company"),
    taskId: positive(input.taskId, "task"),
    actorIdentityHex: identity(scope.actorIdentity),
    actingForIdentityHex: input.actingFor == null ? null : identity(input.actingFor),
    idempotencyKey: commandKey(input.attempt.idempotencyKey),
  }
}

export async function humanTaskClaimExpectation(
  scope: WorkBoardScope,
  input: ClaimHumanTaskInput,
): Promise<HumanTaskCommandExpectation> {
  const base = baseExpectation(scope, input)
  const priorRevision = positive(input.expectedRevision, "task revision")
  return Object.freeze({
    ...base, commandKind: "claim", priorRevision, decision: null,
    inputHash: await humanTaskInputHash([
      base.organizationId, base.companyId, base.taskId, priorRevision,
      base.actingForIdentityHex ?? "",
    ]),
  })
}

export async function humanTaskDecisionExpectation(
  scope: WorkBoardScope,
  input: DecideHumanTaskInput,
): Promise<HumanTaskCommandExpectation> {
  const base = baseExpectation(scope, input)
  const priorRevision = positive(input.expectedTaskRevision, "task revision")
  const instanceRevision = positive(input.expectedInstanceRevision, "workflow revision")
  const tag = approvalTaskStatus({ status: input.decision })
  if (tag !== "Approve" && tag !== "Reject" && tag !== "Complete") throw new Error("Invalid workflow decision")
  const decision = tag.toLowerCase() as "approve" | "reject" | "complete"
  return Object.freeze({
    ...base, commandKind: "decision", priorRevision, decision,
    inputHash: await humanTaskInputHash([
      base.organizationId, base.companyId, base.taskId, priorRevision,
      instanceRevision, decision, base.actingForIdentityHex ?? "",
      normalizeHumanTaskComment(input.comment),
    ]),
  })
}

export async function humanTaskResubmissionExpectation(
  scope: WorkBoardScope,
  input: ResubmitHumanTaskInput,
): Promise<HumanTaskCommandExpectation> {
  const base = baseExpectation(scope, input)
  const priorRevision = positive(input.expectedTaskRevision, "task revision")
  const priorInstanceRevision = positive(input.expectedInstanceRevision, "workflow revision")
  const subjectRevisionHash = input.expectedSubjectRevisionHash
  if (!/^sha256:[0-9a-f]{64}$/.test(subjectRevisionHash)) throw new Error("Invalid approval source revision")
  return Object.freeze({
    ...base, actingForIdentityHex: null, commandKind: "resubmit", decision: null,
    priorRevision, priorInstanceRevision, subjectRevisionHash,
    inputHash: await humanTaskInputHash([
      base.organizationId, base.companyId, base.taskId, priorRevision,
      priorInstanceRevision, subjectRevisionHash, normalizeHumanTaskResubmissionReason(input.reason),
    ]),
  })
}

export function humanTaskCommandReadbackPath(
  scope: WorkBoardScope,
  expected: HumanTaskCommandExpectation,
): string {
  if (String(scope.organizationId) !== expected.organizationId ||
      String(scope.companyId) !== expected.companyId || identity(scope.actorIdentity) !== expected.actorIdentityHex) {
    throw new Error("Workflow command context changed")
  }
  // mine/available are presentation filters; a committed command can leave them.
  const [path, query] = workBoardQueryPath({ ...scope, view: "eligible" }).split("?")
  const params = new URLSearchParams(query)
  params.set("taskId", expected.taskId)
  params.set("commandKind", expected.commandKind)
  params.set("idempotencyKey", expected.idempotencyKey)
  params.set("inputHash", expected.inputHash)
  if (expected.actingForIdentityHex) params.set("actingFor", expected.actingForIdentityHex)
  return `${path}?${params}`
}

const object = (value: unknown): value is object =>
  value != null && typeof value === "object" && !Array.isArray(value)

/** Finite HTTP evidence fields remain unknown until the checks below validate them. */
interface HumanTaskCommandEvidenceWire {
  organizationId?: unknown
  companyId?: unknown
  taskId?: unknown
  workflowInstanceId?: unknown
  eventId?: unknown
  actorIdentityHex?: unknown
  actingForIdentityHex?: unknown
  commandKind?: unknown
  idempotencyKey?: unknown
  inputHash?: unknown
  decision?: unknown
  priorRevision?: unknown
  resultRevision?: unknown
  resultStatus?: unknown
  priorInstanceRevision?: unknown
  subjectRevisionHash?: unknown
  successorTaskId?: unknown
  successorInstanceId?: unknown
  successorTaskRevision?: unknown
  successorInstanceRevision?: unknown
}

const evidenceObject = (value: unknown): value is HumanTaskCommandEvidenceWire => object(value)

/**
 * Only actor-owned immutable receipt/event evidence proves this attempt. Task
 * state alone cannot prove a partial vote, or whose concurrent command won.
 */
export function resolveHumanTaskCommandEffect(
  value: unknown,
  scope: WorkBoardScope,
  expected: HumanTaskCommandExpectation,
): CanonicalRecordRef | null {
  humanTaskCommandReadbackPath(scope, expected)
  const page = parseWorkBoardPage(value, { ...scope, view: "eligible" })
  if (page.data.length > 1) throw new AmbiguousOperationEffectError("Expected one exact workflow task")
  if (page.nextCursor !== null) throw new Error("Exact workflow readback must not be paginated")
  const raw = object(value) && "commandEvidence" in value ? value.commandEvidence : undefined
  if (raw == null) return null
  if (!evidenceObject(raw)) throw new Error("Invalid workflow command evidence")
  const row = page.data[0]
  if (!row || String(row.id) !== expected.taskId) return null
  const numericFields = ["organizationId", "companyId", "taskId", "workflowInstanceId", "eventId", "priorRevision", "resultRevision"] as const
  if (numericFields.some((field) => typeof raw[field] !== "string" || !/^[1-9][0-9]*$/.test(raw[field] as string) || parseStrictU64(raw[field]) == null)) return null
  if (raw.organizationId !== expected.organizationId || raw.companyId !== expected.companyId ||
      raw.taskId !== expected.taskId || raw.actorIdentityHex !== expected.actorIdentityHex ||
      raw.actingForIdentityHex !== expected.actingForIdentityHex || raw.commandKind !== expected.commandKind ||
      raw.idempotencyKey !== expected.idempotencyKey || raw.inputHash !== expected.inputHash ||
      raw.decision !== expected.decision || raw.priorRevision !== expected.priorRevision) return null
  const resultRevision = BigInt(raw.resultRevision as string)
  const currentRevision = parseStrictU64(row.revision)
  if (resultRevision !== BigInt(expected.priorRevision) + 1n || currentRevision == null ||
      currentRevision < resultRevision ||
      parseStrictU64(row.workflowInstanceId ?? row.workflow_instance_id) !== BigInt(raw.workflowInstanceId as string)) return null
  if (expected.commandKind === "resubmit") {
    const successorFields = ["successorTaskId", "successorInstanceId", "successorTaskRevision", "successorInstanceRevision"] as const
    if (raw.resultStatus !== "Cancelled" || approvalTaskStatus(row) !== "Cancelled" ||
      raw.priorInstanceRevision !== expected.priorInstanceRevision ||
      raw.subjectRevisionHash !== expected.subjectRevisionHash ||
      successorFields.some((field) => typeof raw[field] !== "string" || !/^[1-9][0-9]*$/.test(raw[field] as string) || parseStrictU64(raw[field]) == null) ||
      raw.successorTaskId === expected.taskId || raw.successorInstanceId === raw.workflowInstanceId) return null
    return { resource: "workflow-human-tasks", id: raw.successorTaskId as string }
  }
  const terminalStatus = { approve: "Approved", reject: "Rejected", complete: "Completed" } as const
  const partial = expected.decision !== "reject" &&
    approvalTaskStatus({ status: row.assignment }) === "AllCandidates" &&
    raw.resultStatus === "Open"
  const validStatus = expected.commandKind === "claim"
    ? raw.resultStatus === "Claimed"
    : expected.decision != null && (raw.resultStatus === terminalStatus[expected.decision] || partial)
  return validStatus ? { resource: "workflow-human-tasks", id: expected.taskId } : null
}
