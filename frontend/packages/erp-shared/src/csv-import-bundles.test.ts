import assert from "node:assert/strict"
import test from "node:test"

import {
  buildBundleLineCsv,
  buildBundleParentCsv,
  buildOrderIdMapFromSaleOrders,
  detectParentLinkSourceColumn,
  SALE_ORDER_IMPORT_BUNDLE,
  splitImportBundleCsv,
} from "./csv-import-bundles"

test("splitImportBundleCsv deduplicates parent rows and keeps line rows", () => {
  const headers = ["Order Ref", "Customer", "Product", "Qty"]
  const rows = [
    ["SO-1", "100", "200", "2"],
    ["SO-1", "100", "201", "1"],
    ["SO-2", "101", "200", "3"],
  ]
  const parentMapping = {
    "Order Ref": "client_order_ref",
    Customer: "partner_id",
  }
  const lineMapping = {
    Product: "product_id",
    Qty: "product_uom_qty",
  }

  const split = splitImportBundleCsv({
    headers,
    rows,
    parentMapping,
    lineMapping,
    parentLinkSourceColumn: "Order Ref",
  })

  assert.equal(split.parentRows.length, 2)
  assert.equal(split.lineRows.length, 3)
  assert.deepEqual(split.parentLinkValues, ["SO-1", "SO-2"])
})

test("buildBundleParentCsv emits canonical headers", () => {
  const csv = buildBundleParentCsv(
    ["Order Ref", "Customer"],
    [["SO-1", "100"]],
    { "Order Ref": "client_order_ref", Customer: "partner_id" },
  )
  assert.match(csv, /client_order_ref,partner_id/)
  assert.match(csv, /SO-1,100/)
})

test("buildBundleLineCsv resolves order ids from parent refs", () => {
  const headers = ["Product", "Qty"]
  const lineRows = [["200", "2", "SO-1"], ["201", "1", "SO-1"]]
  const orderIdByRef = new Map([["SO-1", "42"]])
  const csv = buildBundleLineCsv(
    headers,
    lineRows,
    { Product: "product_id", Qty: "product_uom_qty" },
    orderIdByRef,
    SALE_ORDER_IMPORT_BUNDLE,
  )
  assert.match(csv, /order_id,product_id,product_uom_qty/)
  assert.match(csv, /42,200,2/)
})

test("buildOrderIdMapFromSaleOrders maps refs to ids", () => {
  const map = buildOrderIdMapFromSaleOrders(
    [
      { id: 10, client_order_ref: "SO-1" },
      { id: 11, clientOrderRef: "SO-2" },
    ],
    ["SO-1", "SO-2", "SO-3"],
  )
  assert.equal(map.get("SO-1"), "10")
  assert.equal(map.get("SO-2"), "11")
  assert.equal(map.has("SO-3"), false)
})

test("detectParentLinkSourceColumn prefers mapped client_order_ref", () => {
  const column = detectParentLinkSourceColumn(
    ["Reference", "SKU"],
    { Reference: "client_order_ref" },
    SALE_ORDER_IMPORT_BUNDLE,
  )
  assert.equal(column, "Reference")
})
