import assert from "node:assert/strict"
import test from "node:test"

import {
  captureStockQuantMoveSnapshot,
  observeStockQuantMove,
} from "./quant-movement"

const source = {
  id: 10,
  productId: 7,
  companyId: 2,
  locationId: 100,
  quantity: 5,
  availableQuantity: 5,
  reservedQuantity: 0,
}

test("partial move to a new destination resolves exactly one created quant", () => {
  const input = { quantId: "10", targetLocationId: "200", quantity: 2 }
  const snapshot = captureStockQuantMoveSnapshot(input, [source])
  assert.ok(snapshot)

  const observed = observeStockQuantMove(input, snapshot, [
    { ...source, quantity: 3, availableQuantity: 3 },
    {
      id: 11,
      productId: 7,
      companyId: 2,
      locationId: 200,
      quantity: 2,
      availableQuantity: 2,
      reservedQuantity: 0,
    },
  ])
  assert.deepEqual(observed.createdRecords, [
    { resource: "stock_quant", id: "11", module: "inventory" },
  ])
  assert.deepEqual(observed.next, observed.createdRecords?.[0])
})

test("partial move to an existing destination keeps both exact ids", () => {
  const input = { quantId: "10", targetLocationId: "200", quantity: 2 }
  const destination = {
    id: 20,
    productId: 7,
    companyId: 2,
    locationId: 200,
    quantity: 4,
    availableQuantity: 4,
  }
  const snapshot = captureStockQuantMoveSnapshot(input, [source, destination])
  assert.ok(snapshot)
  assert.equal(snapshot.destinationIdBefore, "20")

  const observed = observeStockQuantMove(input, snapshot, [
    { ...source, quantity: 3, availableQuantity: 3 },
    { ...destination, quantity: 6, availableQuantity: 6 },
  ])
  assert.deepEqual(observed.next, {
    resource: "stock_quant",
    id: "20",
    module: "inventory",
  })
  assert.equal(observed.createdRecords, undefined)
})

test("full move without existing destination relocates the same quant id", () => {
  const input = { quantId: "10", targetLocationId: "200", quantity: 5 }
  const snapshot = captureStockQuantMoveSnapshot(input, [source])
  assert.ok(snapshot)

  assert.deepEqual(
    observeStockQuantMove(input, snapshot, [
      { ...source, locationId: 200 },
    ]),
    {
      outcome: "applied",
      next: { resource: "stock_quant", id: "10", module: "inventory" },
    },
  )
})

test("ambiguous destination or ambiguous post-state is unresolved", () => {
  const input = { quantId: "10", targetLocationId: "200", quantity: 2 }
  assert.equal(
    captureStockQuantMoveSnapshot(input, [
      source,
      { id: 20, productId: 7, companyId: 2, locationId: 200, quantity: 1 },
      { id: 21, productId: 7, companyId: 2, locationId: 200, quantity: 1 },
    ]),
    undefined,
  )

  const snapshot = captureStockQuantMoveSnapshot(input, [source])
  assert.ok(snapshot)
  assert.deepEqual(
    observeStockQuantMove(input, snapshot, [
      { ...source, quantity: 3, availableQuantity: 3 },
      { id: 20, productId: 7, companyId: 2, locationId: 200, quantity: 2 },
      { id: 21, productId: 7, companyId: 2, locationId: 200, quantity: 2 },
    ]),
    {},
  )
})
