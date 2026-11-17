import assert from "node:assert/strict"
import test from "node:test"

import {
  assistantFarmPortfolio,
  assistantSalesSummary,
  parseAssistantDomainRead,
  readAssistantDomainRead,
} from "./assistant-domain-reads"

const farmEnabled = { farmEnabled: true }

test("sales totals require a single source and an explicit valid period", () => {
  assert.deepEqual(parseAssistantDomainRead("Total Shop Sales for \"April 2024 Shop\" in February 2024", farmEnabled), {
    kind: "sales", module: "shop_sales", from: "2024-02-01", through: "2024-02-29", label: "April 2024 Shop",
  })
  assert.deepEqual(parseAssistantDomainRead("How much were Customer Sales from 2024-04-01 through 2024-04-09?", farmEnabled), {
    kind: "sales", module: "sales", from: "2024-04-01", through: "2024-04-09",
  })
  for (const query of [
    "What were total historical sales in 2024?",
    "Total Shop Sales and Customer Sales for April 2024",
    "Total Shop Sales for Kicukiro in February 2024",
    "Total Shop Sales from 2024-04-09",
    "Total Shop Sales in February 2024 or March 2024",
    "Sum Shop Sales on 2024-02-30",
    "Total Shop Sales for \"April 2024 Shop\"",
  ]) assert.equal(parseAssistantDomainRead(query, farmEnabled)?.kind, "clarify", query)
  assert.equal(parseAssistantDomainRead("Import the total Shop Sales for April 2024", farmEnabled), undefined)
})

test("saved sales summaries retain exactly scoped currency and record provenance", () => {
  const request = { kind: "sales", module: "shop_sales", from: "2024-04-01", through: "2024-04-09" } as const
  const data = {
    companyId: "4097", module: request.module, from: request.from, through: request.through,
    label: null, included: 2, crossingBoundary: 1, sourceRecordIds: ["9007199254740993", "2"],
    totals: [{ currency: "RWF", reportedAmount: "900719925474.000001" }, { currency: "EUR", reportedAmount: "6" }],
  }
  const reply = assistantSalesSummary({ data }, request, 4097)
  assert.match(reply.content, /RWF 900719925474\.000001/)
  assert.match(reply.content, /EUR 6/)
  assert.match(reply.content, /One observation spans a reporting boundary/)
  assert.equal(reply.sources[0]?.href, "/sales?tab=shop-sales&backfillCompany=4097&backfillRecord=9007199254740993")
  assert.deepEqual(assistantSalesSummary({ data }, request, 5).sources, [])
  assert.deepEqual(assistantSalesSummary({ data: { ...data, sourceRecordIds: ["2", "2"] } }, request, 4097).sources, [])
})

test("an Assistant sales question uses the scoped owner endpoint and reports a read limit", async (t) => {
  const input = parseAssistantDomainRead('Total Customer Sales for "Kicukiro East" in 2024-02', farmEnabled)
  assert.equal(input?.kind, "sales")
  if (input?.kind !== "sales") return
  const fetch = t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const route = new URL(String(url), "https://erp.example.test")
    assert.equal(route.pathname, "/api/module-backfill/sales/sales-summary")
    assert.deepEqual(Object.fromEntries(route.searchParams), {
      companyId: "4097", from: "2024-02-01", through: "2024-02-29", label: "Kicukiro East",
    })
    assert.equal(init?.credentials, "include")
    return new Response(null, { status: 422 })
  })
  const result = await readAssistantDomainRead(input, { companyId: 4097, locale: "en" })
  assert.equal(fetch.mock.callCount(), 1)
  assert.match(result.content, /Choose a shorter period/)
  assert.deepEqual(result.sources, [])
})

test("farm reads resolve named references and explicit IDs with a shared reporting cutoff", () => {
  assert.deepEqual(parseAssistantDomainRead('Compare flocks "East and West" and #42 as of 2024-09-30', farmEnabled), {
    kind: "farm", selectors: [{ reference: "East and West" }, { id: "42" }], asOf: "2024-09-30",
  })
  assert.deepEqual(parseAssistantDomainRead('Show metrics for flock "42"', farmEnabled), {
    kind: "farm", selectors: [{ reference: "42" }], asOf: undefined,
  })
  assert.deepEqual(parseAssistantDomainRead("Show headcount for all flocks as of 2024-09-30", farmEnabled), {
    kind: "farm_portfolio", asOf: "2024-09-30",
  })
  assert.equal(parseAssistantDomainRead("Show headcount for all flocks", { farmEnabled: false }), undefined)
  assert.equal(parseAssistantDomainRead("Record mortality for flock East", farmEnabled), undefined)
  assert.equal(parseAssistantDomainRead("Compare flocks #2 and #9999999999999999999", farmEnabled)?.kind, "clarify")
})

test("farm portfolio never turns insufficient headcount into a zero total", () => {
  const data = {
    companyId: "4097", asOf: "2024-09-30", batches: 1, recordedDeaths: "12",
    liveHeadcount: null, sources: [{ id: "42", reference: "East" }],
  }
  const result = assistantFarmPortfolio({ data }, 4097, "en", "2024-09-30")
  assert.match(result.content, /Recorded deaths — 12/)
  assert.match(result.content, /Insufficient records for a company total/)
  assert.equal(result.sources[0]?.href, "/farm-batches/42?view=metrics&asOf=2024-09-30")
  assert.deepEqual(assistantFarmPortfolio({ data }, 9, "en").sources, [])
  assert.deepEqual(assistantFarmPortfolio({ data }, 4097, "en", "2024-09-29").sources, [])
})
