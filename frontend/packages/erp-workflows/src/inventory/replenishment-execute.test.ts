import assert from "node:assert/strict"
import test from "node:test"

import {
  captureReplenishmentExecutionSnapshot,
  observeReplenishmentExecution,
} from "./replenishment-execute"

const input = { ruleId: "9", idempotencyKey: "key-1" }

test("no prior PO: execute resolves exactly one created draft PO", () => {
  const snapshot = captureReplenishmentExecutionSnapshot(input, [])
  assert.ok(snapshot)
  assert.equal(snapshot.poIdBefore, undefined)
  assert.equal(snapshot.partnerRef, "RPL-9")

  const observed = observeReplenishmentExecution(input, snapshot, [
    { id: 30, partnerRef: "RPL-9" },
  ])
  assert.deepEqual(observed.createdRecords, [
    { resource: "purchase_order", id: "30", module: "purchasing", context: "inventory" },
  ])
  assert.deepEqual(observed.next, observed.createdRecords?.[0])
})

test("prior PO (idempotent replay): execute keeps the exact same PO id", () => {
  const existing = { id: 31, partnerRef: "RPL-9" }
  const snapshot = captureReplenishmentExecutionSnapshot(input, [existing])
  assert.ok(snapshot)
  assert.equal(snapshot.poIdBefore, "31")

  const observed = observeReplenishmentExecution(input, snapshot, [existing])
  assert.deepEqual(observed.outcome, "applied")
  assert.deepEqual(observed.next, {
    resource: "purchase_order",
    id: "31",
    module: "purchasing",
    context: "inventory",
  })
  assert.equal(observed.createdRecords, undefined)
})

test("more than one compatible PO fails preflight instead of guessing which one", () => {
  const snapshot = captureReplenishmentExecutionSnapshot(input, [
    { id: 31, partnerRef: "RPL-9" },
    { id: 32, partnerRef: "RPL-9" },
  ])
  assert.equal(snapshot, undefined)
})

test("no PO after dispatch (rule did not trigger demand) does not report success", () => {
  const snapshot = captureReplenishmentExecutionSnapshot(input, [])
  assert.ok(snapshot)

  const observed = observeReplenishmentExecution(input, snapshot, [])
  assert.deepEqual(observed, {})
})
