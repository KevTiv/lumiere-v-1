import assert from "node:assert/strict"
import test from "node:test"
import { historyRecordHref } from "./history-record-href"

test("history links preserve exact record identity and canonical record owners", () => {
  assert.equal(historyRecordHref("sale_order", "18446744073709551615"), "/sales/orders/18446744073709551615")
  assert.equal(historyRecordHref("expense_sheet", "7"), "/expenses/reports/7")
  assert.equal(historyRecordHref("stock_picking", "42"), "/inventory/transfers/42")
  const product = new URL(historyRecordHref("product", "7")!, "https://erp.example")
  assert.equal(product.pathname, "/products")
  assert.equal(product.searchParams.get("filter"), "id:7")
  assert.equal(product.searchParams.get("tab"), "products")
})

test("unknown resources and malformed identifiers cannot construct destinations", () => {
  for (const id of ["0", "01", "-2", "18446744073709551616", "1/../2", undefined]) {
    assert.equal(historyRecordHref("sale_order", id), undefined)
  }
  assert.equal(historyRecordHref("unavailable_record", "2"), undefined)
})
