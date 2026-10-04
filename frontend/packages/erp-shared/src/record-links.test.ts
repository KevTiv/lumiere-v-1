import assert from "node:assert/strict"
import test from "node:test"

import {
  accountMoveHref,
  accountPaymentHref,
  expenseSheetHref,
  moduleTabHref,
  projectTimesheetsHref,
  purchaseOrderHref,
  saleOrderHref,
  stockPickingHref,
} from "./record-links"

test("a record link is the owning tab focused on one id", () => {
  assert.equal(saleOrderHref(12n), "/sales?tab=orders&filter=id%3A12")
  assert.equal(purchaseOrderHref(7), "/purchasing?tab=orders&filter=id%3A7")
  assert.equal(stockPickingHref("5"), "/inventory?tab=transfers&filter=id%3A5")
  assert.equal(accountMoveHref(40n), "/accounting?tab=journal-entries&filter=id%3A40")
  assert.equal(accountPaymentHref(3n), "/accounting?tab=payments&filter=id%3A3")
  assert.equal(expenseSheetHref(9n), "/expenses?tab=expense-sheets&filter=id%3A9")
  assert.equal(projectTimesheetsHref(4n), "/projects?tab=timesheets&filter=projectId%3A4")
})

test("only `tab` and `filter` parameters are ever produced", () => {
  for (const href of [saleOrderHref(1), accountMoveHref(1), expenseSheetHref(1), projectTimesheetsHref(1)]) {
    const params = new URL(href, "http://x").searchParams
    assert.deepEqual([...new Set(params.keys())].sort(), ["filter", "tab"])
  }
})

test("the default tab is omitted and empty filters are dropped", () => {
  assert.equal(moduleTabHref("sales", "dashboard"), "/sales")
  assert.equal(moduleTabHref("/sales", "orders", { state: "Sale", empty: "" }), "/sales?tab=orders&filter=state%3ASale")
  assert.equal(moduleTabHref("fleet", "fleet-vehicles", undefined, "fleet-vehicles"), "/fleet")
})
