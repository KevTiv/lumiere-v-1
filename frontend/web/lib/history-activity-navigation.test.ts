import assert from "node:assert/strict"
import test from "node:test"
import { ALPHA_HISTORY_MODULES, historyActivityHref, historyActivityModule, historyActivitySelection } from "./history-activity-navigation"

test("all current alpha modules and linked record paths have activity without admitting hidden modules", () => {
  for (const module of ALPHA_HISTORY_MODULES) {
    assert.equal(historyActivityModule(`/${module}`), module)
    assert.equal(historyActivityModule(`/${module}/records/42`), module)
  }
  for (const path of ["/messages", "/hr", "/pos", "/manufacturing", "/projects", "/accounting-other", "//accounting"]) {
    assert.equal(historyActivityModule(path), null)
  }
})

test("opening and closing activity preserves filters, tab and business date range", () => {
  const search = "tab=invoices&filter=partner%3A42&period=2024"
  const opened = historyActivityHref("/accounting", search, true)
  assert.equal(new URL(opened, "https://erp.example").searchParams.get("history"), "activity")
  assert.equal(historyActivityHref("/accounting", opened.split("?")[1]!, false), `/accounting?${search}`)
  assert.equal(historyActivityHref("/sales", "history=activity", false), "/sales")
  assert.throws(() => historyActivityHref("//accounting", "", true))
  assert.throws(() => historyActivityHref("/messages", "", true))
})

test("inventory records use inventory activity and preserve the inventory tab", () => {
  assert.equal(historyActivityModule("/inventory"), "inventory")
  assert.equal(historyActivityModule("/inventory/transfers/42"), "inventory")
  assert.equal(
    historyActivityHref("/inventory", "tab=transfers&warehouseId=4", true),
    "/inventory?tab=transfers&warehouseId=4&history=activity",
  )
})

test("exact Activity links retain business filters and clear their authority when closed", () => {
  const selection = { eventId: "org:9007199254740993", companyId: "7" }
  const opened = historyActivityHref("/inventory", "tab=transfers&warehouseId=4", true, selection)
  const { searchParams } = new URL(opened, "https://erp.example")
  assert.deepEqual(historyActivitySelection(searchParams), selection)
  assert.deepEqual(historyActivitySelection(new URLSearchParams("historyEvent=4")), { eventId: "4", companyId: "" })
  assert.equal(historyActivityHref("/inventory", searchParams.toString(), true), "/inventory?tab=transfers&warehouseId=4&history=activity")
  assert.equal(historyActivityHref("/inventory", searchParams.toString(), false), "/inventory?tab=transfers&warehouseId=4")
})
