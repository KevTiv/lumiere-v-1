import assert from "node:assert/strict"
import test from "node:test"

import {
  captureCycleCountAdjustmentSnapshot,
  observeCycleCountAdjustment,
} from "./cycle-count-adjustment"

const input = {
  cycleCountId: "5",
  productId: "7",
  locationId: "100",
  companyId: "2",
  countedQty: 12,
}

test("no prior quant: posting resolves exactly one created quant matching the counted value", () => {
  const snapshot = captureCycleCountAdjustmentSnapshot(input, [])
  assert.ok(snapshot)
  assert.equal(snapshot.quantIdBefore, undefined)

  const observed = observeCycleCountAdjustment(input, snapshot, [
    {
      id: 40,
      productId: 7,
      locationId: 100,
      companyId: 2,
      quantity: 12,
    },
  ])
  assert.deepEqual(observed.createdRecords, [
    { resource: "stock_quant", id: "40", module: "inventory" },
  ])
  assert.deepEqual(observed.next, observed.createdRecords?.[0])
})

test("prior quant: posting keeps the exact same quant id updated to the counted value", () => {
  const existing = {
    id: 41,
    productId: 7,
    locationId: 100,
    companyId: 2,
    quantity: 9,
  }
  const snapshot = captureCycleCountAdjustmentSnapshot(input, [existing])
  assert.ok(snapshot)
  assert.equal(snapshot.quantIdBefore, "41")
  assert.equal(snapshot.quantQuantityBefore, 9)

  const observed = observeCycleCountAdjustment(input, snapshot, [
    { ...existing, quantity: 12 },
  ])
  assert.deepEqual(observed.outcome, "applied")
  assert.deepEqual(observed.next, {
    resource: "stock_quant",
    id: "41",
    module: "inventory",
  })
  assert.equal(observed.createdRecords, undefined)
})

test("more than one compatible quant fails preflight instead of guessing which one", () => {
  const dup = {
    id: 42,
    productId: 7,
    locationId: 100,
    companyId: 2,
    quantity: 3,
  }
  const snapshot = captureCycleCountAdjustmentSnapshot(input, [
    { ...dup, id: 41 },
    dup,
  ])
  assert.equal(snapshot, undefined)
})

test("stale readback (quantity unchanged) does not report success", () => {
  const existing = {
    id: 41,
    productId: 7,
    locationId: 100,
    companyId: 2,
    quantity: 9,
  }
  const snapshot = captureCycleCountAdjustmentSnapshot(input, [existing])
  assert.ok(snapshot)

  const observed = observeCycleCountAdjustment(input, snapshot, [existing])
  assert.deepEqual(observed, {})
})
