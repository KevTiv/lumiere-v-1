import assert from "node:assert/strict"
import test from "node:test"

import { captureSerialBlockSnapshot, observeSerialBlock } from "./serial-block"

const input = { serialId: "12", reason: "Damaged" }

test("existing serial in any state: block resolves to the same id, blocked and locked", () => {
  const snapshot = captureSerialBlockSnapshot(input, [
    { id: 12, state: "free" },
  ])
  assert.ok(snapshot)

  const observed = observeSerialBlock(input, snapshot, [
    { id: 12, state: "blocked", isLocked: true },
  ])
  assert.deepEqual(observed, {
    outcome: "applied",
    next: { resource: "stock_production_serial", id: "12", module: "inventory" },
  })
})

test("unknown serial id fails preflight", () => {
  const snapshot = captureSerialBlockSnapshot(input, [{ id: 13, state: "free" }])
  assert.equal(snapshot, undefined)
})

test("blocked state without is_locked does not report success", () => {
  const snapshot = captureSerialBlockSnapshot(input, [{ id: 12, state: "free" }])
  assert.ok(snapshot)

  const observed = observeSerialBlock(input, snapshot, [
    { id: 12, state: "blocked", isLocked: false },
  ])
  assert.deepEqual(observed, {})
})
