import assert from "node:assert/strict"
import test from "node:test"

import { classifyHttpFailure, toWorkflowError, workflowErrorFromResponse, WorkflowError } from "./errors"

test("statuses map onto the taxonomy", () => {
  assert.equal(classifyHttpFailure(403, "x"), "permission_denied")
  assert.equal(classifyHttpFailure(404, "x"), "not_found")
  assert.equal(classifyHttpFailure(422, "x"), "validation")
  assert.equal(classifyHttpFailure(409, "Order is locked"), "conflict")
  assert.equal(classifyHttpFailure(409, "Picking already validated"), "already_applied")
  assert.equal(classifyHttpFailure(503, "x"), "retryable_transport")
  assert.equal(classifyHttpFailure(500, "x"), "server_failure")
})
test("response bodies surface the server message", () => {
  const json = workflowErrorFromResponse(422, '{"error":"Order has expired"}', "fallback")
  assert.equal(json.message, "Order has expired")
  assert.equal(json.kind, "validation")
  assert.equal(workflowErrorFromResponse(500, "", "fallback").message, "fallback")
  assert.equal(workflowErrorFromResponse(422, "plain text", "fallback").message, "plain text")
})

test("a dropped connection is outcome_unknown unless the write is idempotent", () => {
  const dropped = new TypeError("fetch failed")
  assert.equal(toWorkflowError(dropped).kind, "outcome_unknown")
  assert.ok(toWorkflowError(dropped).needsReadback)
  assert.equal(toWorkflowError(dropped, { idempotent: true }).kind, "retryable_transport")
  assert.ok(toWorkflowError(dropped, { idempotent: true }).retryable)
})

test("workflow errors pass through unchanged", () => {
  const original = new WorkflowError("conflict", "x", { status: 409 })
  assert.equal(toWorkflowError(original), original)
})

test("real reducer rejections arrive as 422 and stay plain rejections, not conflicts or replays", () => {
  const rejections = [
    "Picking must be assigned before validation",
    "Sale order is locked",
    "No lines to invoice on this sale order",
    "Insufficient available quantity for product 4 (need 10, available 6)",
    "Cannot deliver more than on-hand for product 4 (have 6, need 10)",
    "Only draft or sent orders can receive new lines",
    "Sale order must be confirmed before invoicing",
    "Reference already exists for this payment account",
  ]
  for (const message of rejections) assert.equal(classifyHttpFailure(422, message), "validation", message)
})

test("a 422 that says the thing was already done is an already-applied replay", () => {
  for (const message of ["Payment is already posted", "Order already confirmed", "Picking already validated"]) {
    assert.equal(classifyHttpFailure(422, message), "already_applied", message)
    assert.ok(workflowErrorFromResponse(422, message, "x").needsReadback, message)
  }
})

test("a server rejection refreshes the view, a client-side check does not", () => {
  const server = workflowErrorFromResponse(422, '{"error":"Picking must be assigned before validation"}', "x")
  assert.equal(server.kind, "validation")
  assert.ok(server.rejectedByServer)
  assert.ok(server.needsRefresh)

  const client = new WorkflowError("validation", "companyId is required")
  assert.ok(!client.rejectedByServer)
  assert.ok(!client.needsRefresh)

  // Permission and server faults say nothing about the record being out of date.
  assert.ok(!workflowErrorFromResponse(403, "permission denied", "x").needsRefresh)
  assert.ok(!workflowErrorFromResponse(500, "boom", "x").needsRefresh)
})
