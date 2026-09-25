import assert from "node:assert/strict"
import test from "node:test"

import {
  captureQualityCheckFailSnapshot,
  observeQualityCheckFail,
} from "./quality-check-fail"

const source = {
  id: 10,
  productId: 7,
  companyId: 2,
  locationId: 100,
  quantity: 10,
  availableQuantity: 10,
}

const input = {
  checkId: "50",
  productId: "7",
  companyId: "2",
  quarantineLocationId: "200",
  qtyFailed: 4,
}

test("no prior quarantine quant: fail resolves exactly one created destination", () => {
  const snapshot = captureQualityCheckFailSnapshot(input, [source])
  assert.ok(snapshot)
  assert.equal(snapshot.destinationIdBefore, undefined)

  const observed = observeQualityCheckFail(input, snapshot, [
    { ...source, quantity: 6, availableQuantity: 6 },
    {
      id: 20,
      productId: 7,
      companyId: 2,
      locationId: 200,
      quantity: 4,
      availableQuantity: 0,
    },
  ])
  assert.deepEqual(observed.createdRecords, [
    { resource: "stock_quant", id: "20", module: "inventory" },
  ])
  assert.deepEqual(observed.next, observed.createdRecords?.[0])
})

test("prior quarantine quant: fail merges into the exact same destination id", () => {
  const destination = {
    id: 21,
    productId: 7,
    companyId: 2,
    locationId: 200,
    quantity: 3,
    availableQuantity: 0,
  }
  const snapshot = captureQualityCheckFailSnapshot(input, [source, destination])
  assert.ok(snapshot)
  assert.equal(snapshot.destinationIdBefore, "21")

  const observed = observeQualityCheckFail(input, snapshot, [
    { ...source, quantity: 6, availableQuantity: 6 },
    { ...destination, quantity: 7, availableQuantity: 0 },
  ])
  assert.deepEqual(observed.next, {
    resource: "stock_quant",
    id: "21",
    module: "inventory",
  })
  assert.equal(observed.createdRecords, undefined)
})

test("fully consumed source: the source quant id is gone rather than zeroed", () => {
  const fullSource = { ...source, quantity: 4, availableQuantity: 4 }
  const snapshot = captureQualityCheckFailSnapshot(input, [fullSource])
  assert.ok(snapshot)

  const observed = observeQualityCheckFail(input, snapshot, [
    {
      id: 22,
      productId: 7,
      companyId: 2,
      locationId: 200,
      quantity: 4,
      availableQuantity: 0,
    },
  ])
  assert.deepEqual(observed.outcome, "applied")
})

test("more than one on-hand source candidate fails preflight", () => {
  const snapshot = captureQualityCheckFailSnapshot(input, [
    source,
    { ...source, id: 11, locationId: 101 },
  ])
  assert.equal(snapshot, undefined)
})

test("quarantined stock with nonzero available quantity does not report success", () => {
  const snapshot = captureQualityCheckFailSnapshot(input, [source])
  assert.ok(snapshot)

  const observed = observeQualityCheckFail(input, snapshot, [
    { ...source, quantity: 6, availableQuantity: 6 },
    {
      id: 20,
      productId: 7,
      companyId: 2,
      locationId: 200,
      quantity: 4,
      availableQuantity: 4,
    },
  ])
  assert.deepEqual(observed, {})
})
