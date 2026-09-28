import assert from "node:assert/strict"
import test from "node:test"

import { resolveManufacturingMaterialEffect } from "./manufacturing-material-consumption"

const order = {
  id: 5,
  companyId: 7,
  state: { tag: "Progress" },
  bomId: 11,
  productQty: 2,
  locationSrcId: 30,
  moveRawIds: [100, 101],
  moveRawCount: 2,
}

const lines = [
  { id: 1, bomId: 11, productId: 20, productQty: 1, productUomId: 3 },
  { id: 2, bomId: 11, productId: 20, productQty: 2, productUomId: 3 },
]

const moves = [
  {
    id: 100,
    companyId: 7,
    productionId: 5,
    productId: 20,
    productUom: 3,
    productUomQty: 2,
    quantityDone: 2,
    locationId: 30,
    locationDestId: 30,
    state: "done",
    isDone: true,
  },
  {
    id: 101,
    companyId: 7,
    productionId: 5,
    productId: 20,
    productUom: 3,
    productUomQty: 4,
    quantityDone: 4,
    locationId: 30,
    locationDestId: 30,
    state: "done",
    isDone: true,
  },
]

test("resolves exact MO-owned raw moves one-for-one against BOM demand", () => {
  assert.deepEqual(
    resolveManufacturingMaterialEffect([order], lines, moves, 5n, 7n),
    {
      resource: "mrp-productions",
      id: "5",
      companyId: "7",
      bomId: "11",
      stockMoveIds: ["100", "101"],
    },
  )
})

test("does not discover a replacement move outside move_raw_ids", () => {
  const wrongOwnedMove = { ...moves[0]!, state: "assigned", isDone: false }
  const temptingNewerMove = {
    ...moves[0]!,
    id: 999,
    state: "done",
    isDone: true,
  }

  assert.equal(
    resolveManufacturingMaterialEffect(
      [order],
      lines,
      [wrongOwnedMove, moves[1]!, temptingNewerMove],
      5n,
      7n,
    ),
    null,
  )
})

test("fails closed on count, quantity, location, or relation drift", () => {
  assert.equal(
    resolveManufacturingMaterialEffect(
      [{ ...order, moveRawCount: 1 }],
      lines,
      moves,
      5n,
      7n,
    ),
    null,
  )
  assert.equal(
    resolveManufacturingMaterialEffect(
      [order],
      lines,
      [{ ...moves[0]!, quantityDone: 1 }, moves[1]!],
      5n,
      7n,
    ),
    null,
  )
  assert.equal(
    resolveManufacturingMaterialEffect(
      [order],
      lines,
      [{ ...moves[0]!, locationId: 31 }, moves[1]!],
      5n,
      7n,
    ),
    null,
  )
  assert.equal(
    resolveManufacturingMaterialEffect(
      [order],
      lines,
      [{ ...moves[0]!, productionId: 6 }, moves[1]!],
      5n,
      7n,
    ),
    null,
  )
})

test("duplicate raw ids or duplicate rows cannot certify the effect", () => {
  assert.equal(
    resolveManufacturingMaterialEffect(
      [{ ...order, moveRawIds: [100, 100] }],
      lines,
      moves,
      5n,
      7n,
    ),
    null,
  )
  assert.equal(
    resolveManufacturingMaterialEffect(
      [order],
      lines,
      [...moves, { ...moves[0]! }],
      5n,
      7n,
    ),
    null,
  )
})
