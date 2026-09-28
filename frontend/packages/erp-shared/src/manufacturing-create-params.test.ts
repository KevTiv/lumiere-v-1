import assert from "node:assert/strict"
import test from "node:test"

import { toCreateBomByproductParams } from "./manufacturing-create-params"

test("byproduct params map the byproduct's own intent", () => {
  assert.deepEqual(
    toCreateBomByproductParams({
      productId: "42",
      productUomId: 7n,
      productQty: "2.5",
      costShare: "12.5",
      sequence: "3",
      metadata: "  scrap bin  ",
    }),
    {
      productId: 42n,
      productQty: 2.5,
      productUomId: 7n,
      costShare: 12.5,
      sequence: 3,
      metadata: "scrap bin",
    },
  )
})

test("byproduct params require product, UOM and a positive quantity", () => {
  const base = { productId: 42n, productUomId: 7n, productQty: 1 }
  assert.equal(toCreateBomByproductParams({ ...base, productId: undefined }), null)
  assert.equal(toCreateBomByproductParams({ ...base, productUomId: "" }), null)
  assert.equal(toCreateBomByproductParams({ ...base, productQty: 0 }), null)
  assert.equal(toCreateBomByproductParams({ ...base, productQty: "-1" }), null)
})
