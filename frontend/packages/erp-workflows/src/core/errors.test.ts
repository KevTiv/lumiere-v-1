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
