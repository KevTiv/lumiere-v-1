import assert from "node:assert/strict"
import test from "node:test"
import {
  isModuleBackfillRecordId,
  moduleBackfillHref,
  moduleBackfillEmptyHref,
  moduleBackfillRecordHref,
  moduleBackfillReadScope,
} from "./module-backfill-navigation"
import { resolveModuleHistoryFilter } from "@lumiere/ui/lib/module-history-filter"
import { moduleBackfillSavedFields } from "./module-backfill-record"
import { moduleTabDestination } from "./module-tab-navigation"

const base = { pathname: "/accounting", defaultTab: "dashboard", validTabs: ["dashboard", "invoices", "bills"] }

test("changing workspace clears record filters and preserves unrelated context", () => {
  assert.equal(moduleTabDestination({ ...base, query: "tab=invoices&filter=id:12&filter=state:Posted&highlight=12&company=7", tab: "bills" }), "/accounting?tab=bills&company=7")
})

test("opening stock from the location hierarchy applies the location filter to its destination", () => {
  assert.equal(moduleTabDestination({
    pathname: "/inventory",
    query: "tab=location-tree&filter=id:12&highlight=12&company=7",
    tab: "stock",
    defaultTab: "dashboard",
    validTabs: ["dashboard", "location-tree", "stock"],
    filter: { key: "warehouseLocationId", value: "90071992547409931" },
  }), "/inventory?tab=stock&company=7&filter=warehouseLocationId%3A90071992547409931")
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

test("changing tabs leaves the owner queue on the previous history entry", () => {
  const query = "tab=invoices&ownerQueue=overdue-invoices&company=7"
  assert.equal(moduleTabDestination({ ...base, query, tab: "bills" }), "/accounting?tab=bills&company=7")
  assert.equal(moduleTabDestination({ ...base, query, tab: "invoices" }), null)
})

test("import results open their owning list and keep the task filter on that tab", () => {
  const task = "a".repeat(32)
  for (const [module, workspace, tab, defaultTab] of [
    ["sales", "sales", "customer-sales", "orders"],
    ["shop_sales", "sales", "shop-sales", "orders"],
    ["warehouse", "warehouse", "recorded-counts", "stock"],
  ] as const) {
    const href = moduleBackfillHref(module, { id: task, companyId: 7 })
    assert.equal(href, `/${workspace}?tab=${tab}&backfillTask=${task}&backfillCompany=7`)
    const { pathname, search } = new URL(href, "https://example.test")
    assert.equal(moduleTabDestination({
      pathname, query: search, tab: defaultTab, defaultTab, validTabs: [tab, defaultTab],
    }), `/${workspace}`)
  }
})

test("exact saved record links retain company scope and clear on tab changes", () => {
  const id = "9223372036854775807"
  assert.equal(isModuleBackfillRecordId(id), true)
  for (const invalid of [null, 1, "0", "001", "-1", "9223372036854775808"]) {
    assert.equal(isModuleBackfillRecordId(invalid), false)
  }
  const taskId = "a".repeat(32)
  const href = moduleBackfillRecordHref(
    "warehouse",
    { companyId: 7, recordId: id, taskId },
    "tab=recorded-counts&company=7&backfillCompany=3&backfillRecord=12",
  )
  const { pathname, search, searchParams } = new URL(href, "https://example.test")
  assert.deepEqual(
    [searchParams.get("backfillCompany"), searchParams.get("backfillRecord"), searchParams.get("backfillTask")],
    ["7", id, taskId],
  )
  assert.equal(moduleTabDestination({
    pathname, query: search, tab: "stock", defaultTab: "stock", validTabs: ["recorded-counts", "stock"],
  }), "/warehouse?company=7")

  assert.equal(
    moduleBackfillRecordHref("shop_sales", { companyId: 7, recordId: id, taskId }),
    `/sales?tab=shop-sales&backfillCompany=7&backfillRecord=${id}&backfillTask=${taskId}`,
  )

  const matchedHref = moduleBackfillRecordHref(
    "sales",
    { companyId: 7, recordId: id },
    `backfillTask=${taskId}`,
  )
  assert.equal(matchedHref, `/sales?tab=customer-sales&backfillCompany=7&backfillRecord=${id}`)
})

test("recorded count details show stored observations with exact measurement strings", () => {
  const fields = moduleBackfillSavedFields(
    {
      kind: "warehouse",
      product: "Whole chicken",
      pieces: "0",
      kilograms: "0.000",
      location: null,
    },
    (key) => key,
  )
  assert.deepEqual(
    fields.map(({ id, before, after }) => [id, before.kind, after]),
    [
      ["product", "absent", { kind: "value", value: "Whole chicken" }],
      ["pieces", "absent", { kind: "value", value: "0" }],
      ["kilograms", "absent", { kind: "value", value: "0.000" }],
      ["location", "absent", { kind: "value", value: null }],
    ],
  )
})

test("sales summary details preserve currency, exact decimals and incomplete source facts", () => {
  const fields = moduleBackfillSavedFields(
    {
      kind: "sales",
      customer: "Lemigo Hotel",
      product: "Whole chicken",
      quantity: "12.00",
      unit: null,
      unitPrice: "5000.000",
      amount: "60000.00",
      currency: "RWF",
      reportedPayment: "",
    },
    (key) => key,
  )
  assert.deepEqual(
    Object.fromEntries(fields.map(({ id, after }) => [id, after])),
    {
      customer: { kind: "value", value: "Lemigo Hotel" },
      sourceCustomer: { kind: "unavailable" },
      product: { kind: "value", value: "Whole chicken" },
      quantity: { kind: "value", value: "12.00" },
      unit: { kind: "value", value: null },
      unitPrice: { kind: "value", value: "5000.000" },
      amount: { kind: "value", value: "60000.00" },
      currency: { kind: "value", value: "RWF" },
      reportedPayment: { kind: "value", value: "" },
    },
  )
})

test("shop sale receipts open an exact Sales record with its stored shop and prices", () => {
  assert.equal(
    moduleBackfillRecordHref("shop_sales", { companyId: 7, recordId: "51" }),
    "/sales?tab=shop-sales&backfillCompany=7&backfillRecord=51",
  )
  const fields = moduleBackfillSavedFields({
    kind: "shop_sale",
    shop: "Kicukiro",
    product: "Whole chicken",
    quantity: "12.00",
    unit: null,
    unitPrice: "5000.000",
    amount: "60000.00",
    currency: "RWF",
  }, (key) => key)
  assert.deepEqual(fields.map(({ id }) => id), ["shop", "product", "quantity", "unit", "unitPrice", "amount", "currency"])
  assert.deepEqual(fields.find(({ id }) => id === "unitPrice")?.after, { kind: "value", value: "5000.000" })
})

test("historical navigation requires the active company's scoped read grant", () => {
  const session = { identity: "admin", organizationId: 4, activeCompanyId: 7, activeCompanyReady: true, companyIds: [6, 7] }
  assert.deepEqual(moduleBackfillReadScope(session, 4, true), { identity: "admin", companyId: 7 })
  assert.deepEqual(moduleBackfillReadScope({ ...session, activeCompanyId: 6 }, 4, true), { identity: "admin", companyId: 6 })
  assert.equal(moduleBackfillReadScope(session, 4, false), null)
  assert.equal(moduleBackfillReadScope(session, 5, true), null)
  for (const change of [{ activeCompanyReady: false }, { activeCompanyId: 9 }, { activeCompanyId: null }, { identity: null }, { companyIds: undefined }]) {
    assert.equal(moduleBackfillReadScope({ ...session, ...change }, 4, true), null)
  }
})

test("contextual history links require genuinely empty, ready native collections", () => {
  const context = { canRead: true, status: "ready", nativeRowCount: 0 } as const
  for (const period of [null, "all"]) {
    const history = resolveModuleHistoryFilter("sales", "orders", period)
    assert.equal(moduleBackfillEmptyHref("sales", { ...context, history }), "/sales?tab=customer-sales")
  }
  assert.equal(moduleBackfillEmptyHref("warehouse", context), "/warehouse?tab=recorded-counts")
  assert.equal(moduleBackfillEmptyHref("sales", { ...context, canRead: false }), undefined)
  assert.equal(moduleBackfillEmptyHref("sales", { ...context, status: "loading" }), undefined)
  assert.equal(moduleBackfillEmptyHref("warehouse", { ...context, status: "denied" }), undefined)
  assert.equal(moduleBackfillEmptyHref("warehouse", { ...context, nativeRowCount: 1 }), undefined)
  for (const period of ["custom:2024-01-01:2024-01-31", "invalid"]) {
    const history = resolveModuleHistoryFilter("sales", "orders", period)
    assert.equal(moduleBackfillEmptyHref("sales", { ...context, history }), undefined)
  }
})
