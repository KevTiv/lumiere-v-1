import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveHumanTaskClaimEffect,
  resolveHumanTaskDecisionEffect,
  type HumanTaskEffectProjection,
} from "./human-task-effect"
import { AmbiguousOperationEffectError } from "./operation-effect"

const task = (over: Partial<HumanTaskEffectProjection> = {}): HumanTaskEffectProjection => ({
  id: 7n,
  organizationId: 1n,
  status: "Open",
  decision: null,
  assignment: "AnyCandidate",
  revision: 1,
  claimedBy: null,
  decidedBy: null,
  ...over,
})
const expected = { resource: "workflow-human-tasks", id: "7" }

test("claim resolves at the next revision with a claimant", () => {
  assert.deepEqual(
    resolveHumanTaskClaimEffect([task({ status: "Claimed", claimedBy: "0xabc", revision: 2 })], 1n, 7n, 1),
    expected,
  )
})

test("claim does not resolve unclaimed, wrong-revision, foreign or missing tasks", () => {
  assert.equal(resolveHumanTaskClaimEffect([task()], 1n, 7n, 1), null)
  assert.equal(resolveHumanTaskClaimEffect([task({ status: "Claimed", claimedBy: "0xabc", revision: 3 })], 1n, 7n, 1), null)
  assert.equal(resolveHumanTaskClaimEffect([task({ status: "Claimed", claimedBy: null, revision: 2 })], 1n, 7n, 1), null)
  assert.equal(resolveHumanTaskClaimEffect([task({ organizationId: 2n, status: "Claimed", claimedBy: "0xabc", revision: 2 })], 1n, 7n, 1), null)
  assert.equal(resolveHumanTaskClaimEffect([], 1n, 7n, 1), null)
})

test("decision resolves a terminal task with the requested decision and a decider", () => {
  const approved = task({ status: { tag: "Approved" }, decision: { tag: "Approve" }, decidedBy: "0xabc", revision: 3 })
  assert.deepEqual(resolveHumanTaskDecisionEffect([approved], 1n, 7n, "Approve", 2), expected)
  const rejected = task({ status: { Rejected: [] }, decision: { Reject: [] }, decidedBy: "0xabc", revision: 3 })
  assert.deepEqual(resolveHumanTaskDecisionEffect([rejected], 1n, 7n, "Reject", 2), expected)
})

test("decision does not resolve a different decision, missing decider or open task", () => {
  const approved = task({ status: "Approved", decision: "Approve", decidedBy: "0xabc", revision: 3 })
  assert.equal(resolveHumanTaskDecisionEffect([approved], 1n, 7n, "Reject", 2), null)
  assert.equal(resolveHumanTaskDecisionEffect([{ ...approved, decidedBy: null }], 1n, 7n, "Approve", 2), null)
  assert.equal(resolveHumanTaskDecisionEffect([task({ status: "Claimed", revision: 2 })], 1n, 7n, "Approve", 2), null)
})

test("an all-candidates vote that stays open resolves only when the revision advanced", () => {
  const open = task({ assignment: "AllCandidates", status: "Claimed", revision: 3 })
  assert.deepEqual(resolveHumanTaskDecisionEffect([open], 1n, 7n, "Approve", 2), expected)
  assert.equal(resolveHumanTaskDecisionEffect([{ ...open, revision: 2 }], 1n, 7n, "Approve", 2), null)
  assert.equal(resolveHumanTaskDecisionEffect([{ ...open, assignment: "AnyCandidate" }], 1n, 7n, "Approve", 2), null)
})

test("accepts snake_case rows and throws on duplicate ids", () => {
  const row = { id: "7", organization_id: "1", status: "Approved", decision: "Approve", decided_by: "0xabc", revision: 3 }
  assert.deepEqual(resolveHumanTaskDecisionEffect([row], 1n, 7n, "Approve", 2), expected)
  assert.throws(
    () => resolveHumanTaskDecisionEffect([row, row], 1n, 7n, "Approve", 2),
    AmbiguousOperationEffectError,
  )
})
