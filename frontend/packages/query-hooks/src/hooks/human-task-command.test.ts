import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import {
  humanTaskClaimExpectation,
  humanTaskCommandReadbackPath,
  humanTaskDecisionExpectation,
  humanTaskInputHash,
  humanTaskResubmissionExpectation,
  normalizeHumanTaskComment,
  normalizeHumanTaskResubmissionReason,
  resolveHumanTaskCommandEffect,
  type HumanTaskCommandExpectation,
} from "./human-task-command"
import { executeOperationWithCanonicalReadback, AmbiguousOperationEffectError } from "./operation-effect"
import type { WorkBoardScope } from "./work-board-model"

const actor = "ab".repeat(32)
const principal = "cd".repeat(32)
const scope: WorkBoardScope = {
  organizationId: 7, companyId: 11, actorIdentity: actor, authorizationKey: "policy-1",
  scope: "purchasing", view: "available", team: "workflow-group:5",
}
const attempt = { idempotencyKey: "review-attempt-1", correlationId: "correlation-1" }
const input = {
  companyId: 11, taskId: 41, expectedTaskRevision: 3, expectedInstanceRevision: 9,
  decision: { tag: "Approve" as const }, actingFor: principal, comment: " \u0085reviewed é\u0085 ", attempt,
}
const expectedRef = { resource: "workflow-human-tasks", id: "41" }

function evidencePage(expected: HumanTaskCommandExpectation, override: Record<string, unknown> = {}) {
  return {
    data: [{
      id: 41, organizationId: 7, companyId: 11, workflowInstanceId: 70,
      revision: 4, status: "Open", assignment: "AllCandidates",
      workModule: "purchasing", workAssignedToMe: false, workActions: [],
      workTeamRefs: [{ kind: "workflow-group", id: "5" }],
    }],
    nextCursor: null,
    commandEvidence: {
      ...expected, eventId: "99", workflowInstanceId: "70", resultRevision: "4", resultStatus: "Open", ...override,
    },
  }
}

test("hash exactly uses UTF-8 byte lengths and native field boundaries", async () => {
  const fields = ["7", "11", "41", "3", "9", "approve", principal, "reviewed é"]
  const nativeLayout = createHash("sha256")
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8")
    const prefix = Buffer.alloc(8)
    prefix.writeBigUInt64BE(BigInt(bytes.length))
    nativeLayout.update(prefix).update(bytes)
  }
  assert.equal(await humanTaskInputHash(fields), `sha256:${nativeLayout.digest("hex")}`)
  assert.notEqual(await humanTaskInputHash(["ab", "c"]), await humanTaskInputHash(["a", "bc"]))
  const expected = await humanTaskDecisionExpectation(scope, input)
  assert.equal(expected.inputHash, await humanTaskInputHash(fields))
  assert.equal(normalizeHumanTaskComment(" \u0085x\u0085 "), "x")
  assert.equal(normalizeHumanTaskComment("\ufeffx\ufeff"), "\ufeffx\ufeff")
  assert.throws(() => normalizeHumanTaskComment("é".repeat(4097)), /8192 bytes/)
})

test("exact readback retains company/module/team and escapes keys without comments", async () => {
  const expected = await humanTaskDecisionExpectation(scope, { ...input, attempt: { ...attempt, idempotencyKey: "key&?/#" } })
  const url = new URL(humanTaskCommandReadbackPath(scope, expected), "https://example.test")
  assert.equal(url.searchParams.get("companyId"), "11")
  assert.equal(url.searchParams.get("workScope"), "purchasing")
  assert.equal(url.searchParams.get("workView"), "eligible")
  assert.equal(url.searchParams.get("workTeam"), "workflow-group:5")
  assert.equal(url.searchParams.get("taskId"), "41")
  assert.equal(url.searchParams.get("idempotencyKey"), "key&?/#")
  assert.equal(url.searchParams.get("actingFor"), principal)
  assert.equal(url.searchParams.has("comment"), false)
  assert.equal(url.searchParams.has("cursor"), false)
  assert.throws(() => humanTaskCommandReadbackPath({ ...scope, actorIdentity: principal }, expected), /context changed/)
  for (const idempotencyKey of ["key\nline", "key\u007f", "key\u0085"]) {
    await assert.rejects(humanTaskDecisionExpectation(scope, { ...input, attempt: { ...attempt, idempotencyKey } }), /Invalid workflow command key/)
  }
})

test("own partial vote has exact proof even after another voter advances the task", async () => {
  const expected = await humanTaskDecisionExpectation(scope, input)
  const page = evidencePage(expected)
  assert.deepEqual(resolveHumanTaskCommandEffect(page, scope, expected), expectedRef)
  page.data[0]!.revision = 5
  page.data[0]!.status = "Approved"
  assert.deepEqual(resolveHumanTaskCommandEffect(page, scope, expected), expectedRef)
})

test("another actor, principal, key, input, revision, company or event cannot prove the attempt", async () => {
  const expected = await humanTaskDecisionExpectation(scope, input)
  for (const override of [
    { actorIdentityHex: principal }, { actingForIdentityHex: actor }, { actingForIdentityHex: null },
    { idempotencyKey: "other-attempt" }, { inputHash: `sha256:${"0".repeat(64)}` },
    { decision: "reject" }, { commandKind: "claim" }, { organizationId: "8" }, { companyId: "12" },
    { taskId: "42" }, { priorRevision: "2" }, { resultRevision: "5" },
    { workflowInstanceId: "71" }, { eventId: "0" }, { eventId: 99 }, { resultStatus: "Rejected" }, { resultStatus: "Claimed" },
  ]) {
    assert.equal(resolveHumanTaskCommandEffect(evidencePage(expected, override), scope, expected), null, JSON.stringify(override))
  }
  const page = evidencePage(expected)
  page.data[0]!.revision = 3
  assert.equal(resolveHumanTaskCommandEffect(page, scope, expected), null)
})

test("no current authorized row, or state without receipt/event proof, remains unresolved", async () => {
  const expected = await humanTaskDecisionExpectation(scope, input)
  assert.equal(resolveHumanTaskCommandEffect({ ...evidencePage(expected), data: [] }, scope, expected), null)
  assert.equal(resolveHumanTaskCommandEffect({ ...evidencePage(expected), commandEvidence: null }, scope, expected), null)
  assert.equal(resolveHumanTaskCommandEffect({ ...evidencePage(expected), commandEvidence: undefined }, scope, expected), null)
  const page = evidencePage(expected)
  assert.throws(() => resolveHumanTaskCommandEffect({ ...page, data: [...page.data, ...page.data] }, scope, expected), AmbiguousOperationEffectError)
  assert.throws(() => resolveHumanTaskCommandEffect({ ...page, nextCursor: "more" }, scope, expected), /must not be paginated/)
})

test("claim proof survives the available filter and later completion", async () => {
  const expected = await humanTaskClaimExpectation(scope, { companyId: 11, taskId: 41, expectedRevision: 3, attempt })
  const page = evidencePage(expected, { resultStatus: "Claimed" })
  page.data[0]!.status = "Approved"
  page.data[0]!.revision = 5
  assert.deepEqual(resolveHumanTaskCommandEffect(page, scope, expected), expectedRef)
  assert.equal(resolveHumanTaskCommandEffect(evidencePage(expected, { resultStatus: "Approved" }), scope, expected), null)
})

test("a lost response uses exact proof and dispatches once", async () => {
  const expected = await humanTaskDecisionExpectation(scope, input)
  let dispatches = 0
  const result = await executeOperationWithCanonicalReadback({
    resolveBeforeDispatch: false,
    dispatch: async () => { dispatches++; throw new TypeError("Network response lost after commit") },
    resolveEffect: async () => resolveHumanTaskCommandEffect(evidencePage(expected), scope, expected),
    readbackDelayMs: 0,
  })
  assert.equal(result.kind, "converged")
  if (result.kind === "converged") assert.equal(result.dispatch, "ambiguous")
  assert.equal(dispatches, 1)
})

test("lost uncommitted request cannot be confirmed by another reviewer's vote or redispatched", async () => {
  const expected = await humanTaskDecisionExpectation(scope, input)
  let dispatches = 0
  let reads = 0
  const result = await executeOperationWithCanonicalReadback({
    resolveBeforeDispatch: false,
    dispatch: async () => { dispatches++; throw new TypeError("Request never reached server") },
    resolveEffect: async () => { reads++; return resolveHumanTaskCommandEffect(evidencePage(expected, { actorIdentityHex: principal }), scope, expected) },
    readbackAttempts: 3, readbackDelayMs: 0,
  })
  assert.equal(result.kind, "outcome-unknown")
  assert.equal(dispatches, 1)
  assert.equal(reads, 3)
})

test("post-commit read revocation remains unknown without changing the original attempt", async () => {
  const expected = await humanTaskDecisionExpectation(scope, input)
  const result = await executeOperationWithCanonicalReadback({
    resolveBeforeDispatch: false,
    dispatch: async () => ({ kind: "accepted" as const }),
    resolveEffect: async () => { throw new Error("Forbidden") },
    readbackAttempts: 1,
  })
  assert.equal(result.kind, "outcome-unknown")
  assert.deepEqual(await humanTaskDecisionExpectation(scope, input), expected)
  assert.notEqual((await humanTaskDecisionExpectation(scope, { ...input, expectedInstanceRevision: 10 })).inputHash, expected.inputHash)
  assert.notEqual((await humanTaskDecisionExpectation(scope, { ...input, comment: "different" })).inputHash, expected.inputHash)
})

const resubmission = {
  companyId: 11, taskId: 41, expectedTaskRevision: 3, expectedInstanceRevision: 9,
  expectedSubjectRevisionHash: `sha256:${"1".repeat(64)}`, reason: " \u0085Reassign review é\u0085 ", attempt,
}

test("resubmission hashes the reviewed source and reason with the native byte layout", async () => {
  const expected = await humanTaskResubmissionExpectation(scope, resubmission)
  assert.equal(expected.commandKind, "resubmit")
  assert.equal(expected.actingForIdentityHex, null)
  assert.equal(expected.decision, null)
  assert.equal(expected.inputHash, await humanTaskInputHash([
    "7", "11", "41", "3", "9", resubmission.expectedSubjectRevisionHash, "Reassign review é",
  ]))
  const url = new URL(humanTaskCommandReadbackPath(scope, expected), "https://example.test")
  assert.equal(url.searchParams.get("commandKind"), "resubmit")
  assert.equal(url.searchParams.has("actingFor"), false)
  assert.equal(url.searchParams.has("reason"), false)
  assert.equal(JSON.stringify(expected).includes("Reassign review"), false)
  assert.throws(() => normalizeHumanTaskResubmissionReason(" \u0085\n"), /reason is required/)
  assert.throws(() => normalizeHumanTaskResubmissionReason("é".repeat(4097)), /8192 bytes/)
  await assert.rejects(humanTaskResubmissionExpectation(scope, { ...resubmission, expectedSubjectRevisionHash: "invalid" }), /source revision/)
  assert.notEqual((await humanTaskResubmissionExpectation(scope, { ...resubmission, reason: "Another reason" })).inputHash, expected.inputHash)
})

test("resubmission is proved only by the matching cancelled event and distinct linked successor", async () => {
  const expected = await humanTaskResubmissionExpectation(scope, resubmission)
  const evidence = {
    resultStatus: "Cancelled", successorTaskId: "52", successorInstanceId: "80",
    successorTaskRevision: "1", successorInstanceRevision: "2",
  }
  const page = evidencePage(expected, evidence)
  page.data[0]!.status = "Cancelled"
  const successor = { resource: "workflow-human-tasks", id: "52" }
  assert.deepEqual(resolveHumanTaskCommandEffect(page, scope, expected), successor)
  for (const override of [
    { actorIdentityHex: principal }, { actingForIdentityHex: principal },
    { idempotencyKey: "competing-resubmission" }, { priorInstanceRevision: "10" },
    { subjectRevisionHash: `sha256:${"2".repeat(64)}` }, { successorTaskId: "41" },
    { successorTaskId: "0" }, { successorTaskId: "052" }, { successorInstanceId: "70" },
    { successorTaskRevision: undefined }, { successorInstanceRevision: "18446744073709551616" },
    { resultStatus: "Open" }, { resultRevision: "5" }, { decision: "approve" },
  ]) {
    assert.equal(resolveHumanTaskCommandEffect({ ...page, commandEvidence: { ...page.commandEvidence, ...override } }, scope, expected), null, JSON.stringify(override))
  }
  page.data[0]!.status = "Open"
  assert.equal(resolveHumanTaskCommandEffect(page, scope, expected), null)
  page.data[0]!.status = "Cancelled"
  let dispatches = 0
  const result = await executeOperationWithCanonicalReadback({
    resolveBeforeDispatch: false,
    dispatch: async () => { dispatches++; throw new TypeError("Lost resubmission response") },
    resolveEffect: async () => resolveHumanTaskCommandEffect(page, scope, expected),
    readbackDelayMs: 0,
  })
  assert.equal(result.kind, "converged")
  assert.equal(dispatches, 1)
})
