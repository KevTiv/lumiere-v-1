import assert from "node:assert/strict"
import test from "node:test"

import { toCreateBomByproductParams, toCreateBomParams } from "./manufacturing-create-params"

test("BOM components preserve each product's own UOM and quantity", () => {
  const params = toCreateBomParams({ productTmplId: "42", bomLines: [
    { productId: "43", productUomId: "8", productQty: "2.5" },
    { productId: "44", productUomId: "9", productQty: "3" },
  ] }, { productUomId: 7n, companyId: 1n })
  assert.deepEqual(params?.lines.map(({ productId, productUomId, productQty, sequence }) => ({ productId, productUomId, productQty, sequence })), [
    { productId: 43n, productUomId: 8n, productQty: 2.5, sequence: 10 },
    { productId: 44n, productUomId: 9n, productQty: 3, sequence: 20 },
  ])
})

test("BOM components reject incomplete or malformed intent without dropping lines", () => {
  const context = { productUomId: 7n, companyId: 1n }
  const valid = { productId: "43", productUomId: "8", productQty: 1 }
  for (const invalid of [null, [], { ...valid, productId: "" }, { ...valid, productUomId: undefined }, { ...valid, productQty: 0 }, { ...valid, productQty: "bad" }]) {
    assert.equal(toCreateBomParams({ productTmplId: "42", bomLines: [valid, invalid] }, context), null)
  }
  assert.equal(toCreateBomParams({ productTmplId: "42", bomLines: "{" }, context), null)
  assert.equal(toCreateBomParams({ productTmplId: "42", bomLines: "{}" }, context), null)
})

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
