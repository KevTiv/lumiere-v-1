import assert from "node:assert/strict"
import test from "node:test"

import {
  captureSerialReserveSnapshot,
  observeSerialReserve,
} from "./serial-reserve"

const input = { serialId: "12" }

test("existing free serial: reserve resolves to the same id with state reserved", () => {
  const snapshot = captureSerialReserveSnapshot(input, [
    { id: 12, state: "free" },
  ])
  assert.ok(snapshot)

  const observed = observeSerialReserve(input, snapshot, [
    { id: 12, state: "reserved" },
  ])
  assert.deepEqual(observed, {
    outcome: "applied",
    next: { resource: "stock_production_serial", id: "12", module: "inventory" },
  })
})

test("unknown serial id fails preflight", () => {
  const snapshot = captureSerialReserveSnapshot(input, [
    { id: 13, state: "free" },
  ])
  assert.equal(snapshot, undefined)
})

test("state unchanged after dispatch does not report success", () => {
  const snapshot = captureSerialReserveSnapshot(input, [
    { id: 12, state: "free" },
  ])
  assert.ok(snapshot)

  const observed = observeSerialReserve(input, snapshot, [
    { id: 12, state: "free" },
  ])
  assert.deepEqual(observed, {})
})
