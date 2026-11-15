import assert from "node:assert/strict"
import test from "node:test"
import { farmEventPrefill } from "./farm-assistant-prefill"
import {
  FarmApiError,
  eventSummary,
  farmApiPath,
  farmDate,
  farmRecordId,
  farmResponse,
  selectedFarmEventKind,
  selectedFarmView,
} from "./farm-batch-model"

test("farm action URLs preserve scoped identifiers and fall back for invalid views or dates", () => {
  assert.equal(farmRecordId("9007199254740993"), true)
  assert.equal(farmRecordId("18446744073709551616"), false)
  assert.equal(farmRecordId("../overview"), false)
  assert.equal(farmDate("2026-02-29"), undefined)
  assert.equal(farmDate("2024-02-29"), "2024-02-29")
  assert.equal(selectedFarmView("costs"), "costs")
  assert.equal(selectedFarmView("native-links"), "overview")
  assert.equal(selectedFarmEventKind("weighIn"), "weighIn")
  assert.equal(selectedFarmEventKind("__proto__"), "intake")
  assert.equal(
    farmApiPath("4097", "/42", { asOf: "2026-11-01" }),
    "/api/farm-batches/42?asOf=2026-11-01&companyId=4097",
  )
})

test("processing summaries preserve zero measured output and omit absent live weight", () => {
  assert.equal(
    eventSummary(
      {
        id: "42",
        revision: 1,
        kind: "processing",
        businessDate: "2026-11-01",
        count: 7,
        sellableWeightKg: 0,
      },
      "en",
    ),
    "7 animals · 0 kg sellable",
  )
})

test("assistant prefills only unambiguous scoped observations", () => {
  assert.deepEqual(
    farmEventPrefill("mortality", "Record mortality for batch #42 of 12 birds on 2026-11-15."),
    {
      count: 12,
      businessDate: "2026-11-15",
    },
  )
  assert.deepEqual(farmEventPrefill("weighIn", "We weighed 12 birds; total sampled weight 17.2 kg."), {
    sampleCount: 12,
    totalWeightKg: 17.2,
  })
  const ambiguous = farmEventPrefill("mortality", "12 birds on 2026-11-15 or 14 birds on 2026-11-16")
  assert.equal(ambiguous.count, undefined)
  assert.equal(ambiguous.businessDate, undefined)
  assert.equal(
    farmEventPrefill("weighIn", "We weighed 12 birds at 2 kg each.").totalWeightKg,
    undefined,
  )
})

test("a successful HTTP response without a native result still requires confirmation", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json("Unexpected result"))
  await assert.rejects(
    farmResponse("/api/farm-batches"),
    (error) => error instanceof FarmApiError && error.status === 502,
  )
  fetch.mock.mockImplementation(async () => Response.json({ data: [], nextBeforeId: "42" }))
  assert.deepEqual(await farmResponse("/api/farm-batches"), { data: [], nextBeforeId: "42" })
})
