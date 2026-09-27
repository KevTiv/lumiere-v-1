import assert from "node:assert/strict"
import test from "node:test"

import { captureSerialUseSnapshot, observeSerialUse } from "./serial-use"

const input = { serialId: "12" }

test("existing reserved serial: use resolves to the same id with state in_use", () => {
  const snapshot = captureSerialUseSnapshot(input, [
    { id: 12, state: "reserved" },
  ])
  assert.ok(snapshot)

  const observed = observeSerialUse(input, snapshot, [
    { id: 12, state: "in_use" },
  ])
  assert.deepEqual(observed, {
    outcome: "applied",
    next: { resource: "stock_production_serial", id: "12", module: "inventory" },
  })
})

test("unknown serial id fails preflight", () => {
  const snapshot = captureSerialUseSnapshot(input, [{ id: 13, state: "reserved" }])
  assert.equal(snapshot, undefined)
})

test("state unchanged after dispatch does not report success", () => {
  const snapshot = captureSerialUseSnapshot(input, [
    { id: 12, state: "reserved" },
  ])
  assert.ok(snapshot)

  const observed = observeSerialUse(input, snapshot, [
    { id: 12, state: "reserved" },
  ])
  assert.deepEqual(observed, {})
})
