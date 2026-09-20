import assert from "node:assert/strict"
import test from "node:test"

import { createFakeCompletionPorts } from "../testing"
import { WorkflowError, type WorkflowErrorKind } from "./errors"
import { recordRef } from "./record-ref"
import { completeTransition, newCorrelationId, type TransitionSpec } from "./transition"

const failing = (kind: WorkflowErrorKind, status?: number): TransitionSpec<string> => ({
  id: "test.fail",
  command: async () => {
    throw new WorkflowError(kind, `${kind} happened`, { status })
  },
  affects: ["sale-orders"],
})

const succeeding = (overrides: Partial<TransitionSpec<string>> = {}): TransitionSpec<string> => ({
  id: "test.ok",
  command: async () => undefined,
  affects: ["sale-orders", "stock-pickings"],
  ...overrides,
})

test("a stale or conflicting write did not commit but still refreshes what the user was looking at", async () => {
  for (const kind of ["stale_revision", "conflict", "not_found"] as const) {
    const fake = createFakeCompletionPorts()
    await assert.rejects(completeTransition(failing(kind), "1", fake.ports))
    assert.deepEqual(fake.invalidated, [["sale-orders"]], kind)
    assert.equal(fake.notices[0]?.refreshed, true, kind)
  }
})

test("a write that may have landed refreshes as well", async () => {
  for (const kind of ["outcome_unknown", "already_applied"] as const) {
    const fake = createFakeCompletionPorts()
    await assert.rejects(completeTransition(failing(kind), "1", fake.ports))
    assert.deepEqual(fake.invalidated, [["sale-orders"]], kind)
  }
})

test("a plain rejection changes nothing and refreshes nothing", async () => {
  for (const kind of ["validation", "permission_denied", "approval_required", "retryable_transport", "server_failure"] as const) {
    const fake = createFakeCompletionPorts()
    await assert.rejects(completeTransition(failing(kind), "1", fake.ports))
    assert.deepEqual(fake.invalidated, [], kind)
    assert.equal(fake.notices[0]?.refreshed, false, kind)
  }
})

test("a failed refresh is reported as not refreshed, and the original error still surfaces", async () => {
  const fake = createFakeCompletionPorts({ failInvalidate: true })
  await assert.rejects(completeTransition(failing("stale_revision"), "1", fake.ports), (e: unknown) => {
    assert.ok(e instanceof WorkflowError)
    assert.equal(e.kind, "stale_revision")
    return true
  })
  assert.equal(fake.notices[0]?.refreshed, false)
  assert.equal(fake.events[0]?.refreshed, false)
})

test("a successful run logs the outcome, duration, affected resources and created record ids", async () => {
  const fake = createFakeCompletionPorts()
  const invoice = recordRef("account_move", 41, "accounting", "sales")
  await completeTransition(succeeding({ observe: async () => ({ createdRecords: [invoice] }) }), "5", fake.ports)
  const [event] = fake.events
  assert.equal(event?.status, "applied")
  assert.equal(event?.transitionId, "test.ok")
  assert.equal(event?.attempt, 1)
  assert.ok((event?.durationMs ?? -1) >= 0)
  assert.deepEqual(event?.affectedResources, ["sale-orders", "stock-pickings"])
  assert.deepEqual(event?.createdRecords, [{ resource: "account_move", id: "41" }])
  assert.equal(event?.correlationId, fake.notices[0]?.correlationId)
})

test("an approval hand-off is logged as approval_pending, not applied", async () => {
  const fake = createFakeCompletionPorts()
  await completeTransition(succeeding({ observe: async () => ({ outcome: "approval_pending" }) }), "5", fake.ports)
  assert.equal(fake.events[0]?.status, "approval_pending")
})

test("a failed run logs the failure kind and HTTP status", async () => {
  const fake = createFakeCompletionPorts()
  await assert.rejects(completeTransition(failing("conflict", 409), "5", fake.ports))
  const [event] = fake.events
  assert.equal(event?.status, "failed")
  assert.equal(event?.errorKind, "conflict")
  assert.equal(event?.httpStatus, 409)
})

test("the log never contains the command input", async () => {
  const fake = createFakeCompletionPorts()
  const secret = { customerEmail: "a@b.test", iban: "DE89 3704 0044 0532 0130 00" }
  await completeTransition(succeeding({ command: async () => undefined }), secret as never, fake.ports)
  await assert.rejects(completeTransition(failing("validation", 422), secret as never, fake.ports))
  const serialized = JSON.stringify(fake.events)
  assert.ok(!serialized.includes("a@b.test"))
  assert.ok(!serialized.includes("DE89"))
})

test("each run has its own correlation id, and attempt comes from the options", async () => {
  const fake = createFakeCompletionPorts()
  await completeTransition(succeeding(), "1", fake.ports)
  await completeTransition(succeeding(), "1", fake.ports, { attempt: 3 })
  assert.notEqual(fake.events[0]?.correlationId, fake.events[1]?.correlationId)
  assert.equal(fake.events[1]?.attempt, 3)
  assert.notEqual(newCorrelationId(), newCorrelationId())
})

test("a failing log sink never turns a finished transition into a failure", async () => {
  const fake = createFakeCompletionPorts({ failRecord: true })
  const result = await completeTransition(succeeding(), "1", fake.ports)
  assert.equal(result.outcome, "applied")
  await assert.rejects(completeTransition(failing("validation"), "1", fake.ports), (e: unknown) => {
    assert.ok(e instanceof WorkflowError)
    assert.equal(e.kind, "validation")
    return true
  })
})
