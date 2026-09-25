import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveManufacturingFinishedEffect,
  resolveManufacturingProductionQuantityEffect,
} from "./manufacturing-production-close"

const producedOrder = {
  id: 5,
  companyId: 7,
  state: { tag: "ToClose" },
  productId: 20,
  productQty: 2,
  productUomId: 3,
  qtyProduced: 2,
  qtyProducing: 2,
  locationSrcId: 30,
  locationDestId: 40,
  moveFinishedIds: [],
  moveFinishedCount: 0,
}

test("production readback requires exact same MO quantity and state", () => {
  assert.deepEqual(
    resolveManufacturingProductionQuantityEffect(
      [producedOrder],
      5n,
      7n,
      2,
      "toclose",
    ),
    {
      resource: "mrp-productions",
      id: "5",
      companyId: "7",
      qtyProduced: 2,
      state: "toclose",
    },
  )

  assert.equal(
    resolveManufacturingProductionQuantityEffect(
      [{ ...producedOrder, qtyProduced: 1 }],
      5n,
      7n,
      2,
      "toclose",
    ),
    null,
  )
  assert.equal(
    resolveManufacturingProductionQuantityEffect(
      [{ ...producedOrder, state: "Progress" }],
      5n,
      7n,
      2,
      "toclose",
    ),
    null,
  )
})

test("finished effect resolves only the MO-owned move and exact destination quant delta", () => {
  const done = {
    ...producedOrder,
    state: "Done",
    moveFinishedIds: [88],
    moveFinishedCount: 1,
  }
  const move = {
    id: 88,
    companyId: 7,
    productionId: 5,
    productId: 20,
    productUom: 3,
    productUomQty: 2,
    quantityDone: 2,
    locationId: 30,
    locationDestId: 40,
    state: "done",
    isDone: true,
  }
  const quant = {
    id: 101,
    companyId: 7,
    productId: 20,
    locationId: 40,
    quantity: 7,
  }

  assert.deepEqual(
    resolveManufacturingFinishedEffect(
      [done],
      [move],
      [quant],
      5n,
      7n,
      { id: 101n, quantity: 5 },
    ),
    {
      resource: "mrp-productions",
      id: "5",
      companyId: "7",
      finishedMoveId: "88",
      destinationQuantId: "101",
    },
  )
})

test("new destination quant is accepted only when its quantity equals produced output", () => {
  const done = {
    ...producedOrder,
    state: "Done",
    moveFinishedIds: [88],
    moveFinishedCount: 1,
  }
  const move = {
    id: 88,
    companyId: 7,
    productionId: 5,
    productId: 20,
    productUom: 3,
    productUomQty: 2,
    quantityDone: 2,
    locationId: 30,
    locationDestId: 40,
    state: "done",
    isDone: true,
  }

  assert.ok(
    resolveManufacturingFinishedEffect(
      [done],
      [move],
      [{ id: 101, companyId: 7, productId: 20, locationId: 40, quantity: 2 }],
      5n,
      7n,
      { quantity: 0 },
    ),
  )
  assert.equal(
    resolveManufacturingFinishedEffect(
      [done],
      [move],
      [{ id: 101, companyId: 7, productId: 20, locationId: 40, quantity: 3 }],
      5n,
      7n,
      { quantity: 0 },
    ),
    null,
  )
})

test("unowned newer moves, duplicate quants, and wrong terminal move state fail closed", () => {
  const done = {
    ...producedOrder,
    state: "Done",
    moveFinishedIds: [88],
    moveFinishedCount: 1,
  }
  const move = {
    id: 88,
    companyId: 7,
    productionId: 5,
    productId: 20,
    productUom: 3,
    productUomQty: 2,
    quantityDone: 2,
    locationId: 30,
    locationDestId: 40,
    state: "done",
    isDone: true,
  }
  const quant = {
    id: 101,
    companyId: 7,
    productId: 20,
    locationId: 40,
    quantity: 7,
  }

  assert.equal(
    resolveManufacturingFinishedEffect(
      [done],
      [{ ...move, state: "assigned", isDone: false }, { ...move, id: 999 }],
      [quant],
      5n,
      7n,
      { id: 101n, quantity: 5 },
    ),
    null,
  )

  assert.throws(() =>
    resolveManufacturingFinishedEffect(
      [done],
      [move],
      [quant, { ...quant, id: 102 }],
      5n,
      7n,
      { quantity: 5 },
    ),
  )
})
