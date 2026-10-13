import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveManufacturingFinishedEffect,
  resolveManufacturingProductionQuantityEffect,
} from "./manufacturing-production-close"
import { AmbiguousOperationEffectError } from "./operation-effect"

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

const primaryOutput = {
  id: 88, companyId: 7, productionId: 5, productId: 20, productUom: 3,
  productUomQty: 2, quantityDone: 2, locationId: 30, locationDestId: 40,
  state: "done", isDone: true, scrapped: false, reference: "MO/5",
}
const byproductOutput = {
  ...primaryOutput, id: 89, productId: 21, productUomQty: 1, quantityDone: 1,
  reference: "MO/5/BYPRODUCT/12",
}
const anotherByproductOutput = {
  ...byproductOutput, id: 90, productId: 22, productUomQty: 0.5, quantityDone: 0.5,
  reference: "MO/5/BYPRODUCT/13",
}
const finishedQuant = {
  id: 101, companyId: 7, productId: 20, locationId: 40, quantity: 7,
}

test("finish resolves zero, one and multiple legitimate MO-owned byproducts", () => {
  for (const byproducts of [[], [byproductOutput], [byproductOutput, anotherByproductOutput]]) {
    // Put primary last: relation membership/product identity, not list position, owns it.
    const moves = [...byproducts, primaryOutput]
    const order = {
      ...producedOrder, state: "Done",
      moveFinishedIds: moves.map(move => move.id), moveFinishedCount: moves.length,
    }
    assert.deepEqual(
      resolveManufacturingFinishedEffect([order], moves, [finishedQuant], 5n, 7n, { id: 101n, quantity: 5 }),
      {
        resource: "mrp-productions", id: "5", companyId: "7",
        finishedMoveId: "88", destinationQuantId: "101",
      },
    )
  }
})

test("byproduct output sets reject missing, duplicate, unowned and unfinished effects", () => {
  const order = {
    ...producedOrder, state: "Done", moveFinishedIds: [88, 89], moveFinishedCount: 2,
  }
  const resolve = (moves: Array<typeof primaryOutput>) =>
    resolveManufacturingFinishedEffect([order], moves, [finishedQuant], 5n, 7n, { id: 101n, quantity: 5 })
  assert.equal(resolve([primaryOutput]), null)
  assert.equal(resolve([byproductOutput]), null)
  for (const invalid of [
    { ...byproductOutput, productionId: 6 },
    { ...byproductOutput, companyId: 8 },
    { ...byproductOutput, locationDestId: 41 },
    { ...byproductOutput, state: "assigned" },
    { ...byproductOutput, quantityDone: 0.5 },
    { ...byproductOutput, scrapped: true },
    { ...byproductOutput, reference: "MO/6/BYPRODUCT/12" },
    { ...byproductOutput, reference: "MO/5/RAW/12" },
  ]) assert.equal(resolve([primaryOutput, invalid]), null)
  assert.throws(() => resolve([primaryOutput, byproductOutput, byproductOutput]), AmbiguousOperationEffectError)
  assert.throws(
    () => resolve([primaryOutput, { ...byproductOutput, productId: 20 }]),
    AmbiguousOperationEffectError,
  )
  assert.equal(
    resolveManufacturingFinishedEffect([{ ...order, moveFinishedCount: 1 }], [primaryOutput, byproductOutput], [finishedQuant], 5n, 7n, { quantity: 5 }),
    null,
  )
  assert.throws(
    () => resolveManufacturingFinishedEffect(
      [{ ...order, moveFinishedIds: [88, 88] }],
      [primaryOutput], [finishedQuant], 5n, 7n, { quantity: 5 },
    ),
    AmbiguousOperationEffectError,
  )
  assert.throws(
    () => resolveManufacturingFinishedEffect(
      [{ ...order, moveFinishedIds: [88, 89, 90], moveFinishedCount: 3 }],
      [primaryOutput, byproductOutput, { ...anotherByproductOutput, productId: 21 }],
      [finishedQuant], 5n, 7n, { quantity: 5 },
    ),
    AmbiguousOperationEffectError,
  )
  assert.throws(
    () => resolveManufacturingFinishedEffect(
      [{ ...order, moveFinishedIds: [88, 89, 90], moveFinishedCount: 3 }],
      [primaryOutput, byproductOutput, { ...anotherByproductOutput, reference: byproductOutput.reference }],
      [finishedQuant], 5n, 7n, { quantity: 5 },
    ),
    AmbiguousOperationEffectError,
  )
})
