import assert from "node:assert/strict"
import test from "node:test"
import { pinnedSourceReview } from "@lumiere/query-hooks/hooks/source-review-navigation"
import { getProductSurfaceForPathname, isFirstOrgRouteAdmitted } from "@lumiere/ui/lib/product-surface-catalog"
import { i18n } from "../../../../packages/i18n/src/config"
import { farmPageCursors, farmPageHref } from "./farm-pagination"
import { farmEventPrefill } from "./farm-assistant-prefill"
import {
  FarmApiError,
  eventSummary,
  farmApiPath,
  farmDate,
  farmImportHref,
  farmSourceReviewHref,
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
      i18n.getFixedT("en"),
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

test("farm import and pinned provenance stay inside the admitted Farm Batches product surface", () => {
  const companyId = "4097"
  const intake = new URL(farmImportHref(companyId), "https://erp.test")
  assert.equal(intake.pathname, "/farm-batches/import")
  assert.equal(intake.searchParams.get("companyId"), companyId)
  assert.equal(intake.hash, "#start-import")
  const surface = getProductSurfaceForPathname(intake.pathname)
  assert.equal(surface?.id, "farm-batches")
  assert.equal(isFirstOrgRouteAdmitted(surface!.id, false), true)

  const source = { reviewBatchId: "24", reviewItemId: "9007199254740993", revision: 3 }
  const href = farmSourceReviewHref(companyId, source)
  assert.ok(href)
  const review = new URL(href, "https://erp.test")
  assert.equal(review.pathname, intake.pathname)
  assert.equal(review.hash, "#source-review-history")
  assert.deepEqual(pinnedSourceReview(review.search, companyId), {
    batchId: source.reviewBatchId, itemId: source.reviewItemId, revision: 3,
  })
  assert.equal(pinnedSourceReview(review.search, "4098"), null)
  assert.equal(farmSourceReviewHref(companyId, { ...source, revision: 0 }), undefined)
  assert.equal(farmSourceReviewHref(companyId, { file: "old.csv", row: 8 }), undefined)
})

test("list cursors survive a detail round trip and step back to each prior page", () => {
  const scope = JSON.stringify([12, "4097"])
  const cursors = ["63", "43", "23"]
  const detail = new URL(farmPageHref(scope, cursors, "/farm-batches/21"), "https://example.test")
  detail.searchParams.set("view", "metrics")
  detail.searchParams.set("asOf", "2026-11-01")
  const list = new URL(farmPageHref(scope, farmPageCursors(detail.searchParams, scope)), detail)
  assert.equal(list.pathname, "/farm-batches")
  assert.equal(list.searchParams.has("view"), false)
  assert.equal(list.searchParams.has("asOf"), false)
  for (let length = cursors.length; length > 0; length--) {
    const current = farmPageCursors(list.searchParams, scope)
    assert.deepEqual(current, cursors.slice(0, length))
    list.href = new URL(farmPageHref(scope, current.slice(0, -1)), list).href
  }
  assert.equal(list.search, "")
  assert.deepEqual(farmPageCursors(detail.searchParams, JSON.stringify([12, "4098"])), [])
  assert.deepEqual(farmPageCursors(detail.searchParams, JSON.stringify([13, "4097"])), [])
  detail.searchParams.append("beforeId", "../other")
  assert.deepEqual(farmPageCursors(detail.searchParams, scope), [])
})
