import assert from "node:assert/strict"
import test from "node:test"
import { moduleTabDestination } from "./module-tab-navigation"

const base = { pathname: "/accounting", defaultTab: "dashboard", validTabs: ["dashboard", "invoices", "bills"] }

test("changing workspace clears record filters and preserves unrelated context", () => {
  assert.equal(moduleTabDestination({ ...base, query: "tab=invoices&filter=id:12&filter=state:Posted&highlight=12&company=7", tab: "bills" }), "/accounting?tab=bills&company=7")
})

test("returning to the overview preserves its canonical URL", () => {
  assert.equal(moduleTabDestination({ ...base, query: "tab=bills&filter=id:12", tab: "dashboard" }), "/accounting")
})

test("reselecting a workspace preserves its deep-link filters without another history entry", () => {
  assert.equal(moduleTabDestination({ ...base, query: "tab=invoices&filter=id:12", tab: "invoices" }), null)
})

test("unknown destinations cannot be written to history", () => {
  assert.equal(moduleTabDestination({ ...base, query: "", tab: "missing" }), null)
  assert.equal(moduleTabDestination({ ...base, query: "tab=missing", tab: "invoices" }), "/accounting?tab=invoices")
})
