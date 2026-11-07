import assert from "node:assert/strict"
import test from "node:test"
import { ALPHA_HISTORY_MODULES, historyActivityHref, historyActivityModule } from "./history-activity-navigation"

test("all current alpha modules and linked record paths have activity without admitting hidden modules", () => {
  for (const module of ALPHA_HISTORY_MODULES) {
    assert.equal(historyActivityModule(`/${module}`), module)
    assert.equal(historyActivityModule(`/${module}/records/42`), module)
  }
  for (const path of ["/inventory", "/messages", "/hr", "/pos", "/manufacturing", "/projects", "/accounting-other", "//accounting"]) {
    assert.equal(historyActivityModule(path), null)
  }
})

test("opening and closing activity preserves filters, tab and business date range", () => {
  const search = "tab=invoices&filter=partner%3A42&period=2024&historyCompany=9"
  const opened = historyActivityHref("/accounting", search, true)
  assert.equal(new URL(opened, "https://erp.example").searchParams.get("history"), "activity")
  assert.equal(historyActivityHref("/accounting", opened.split("?")[1]!, false), `/accounting?${search}`)
  assert.equal(historyActivityHref("/sales", "history=activity", false), "/sales")
  assert.throws(() => historyActivityHref("//accounting", "", true))
  assert.throws(() => historyActivityHref("/inventory", "", true))
})
