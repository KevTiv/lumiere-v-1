import assert from "node:assert/strict"
import test from "node:test"
import { manufacturingResultLinks, resolvedManufacturingResultLinks } from "./manufacturing-result-links"

test("scrap and byproduct results open their exact real module tab", () => {
  assert.equal(manufacturingResultLinks({ resource: "stock-moves", id: "71" })[0]?.href,
    "/inventory?tab=stock-moves&filter=id%3A71")
  assert.equal(manufacturingResultLinks({ resource: "mrp-bom-byproducts", id: "52" })[0]?.href,
    "/manufacturing?tab=bom-byproducts&filter=id%3A52")
})

test("completion keeps every proven output identity and destination stock", () => {
  const ref = { resource: "mrp-productions", id: "99", finishedMoveId: "71", finishedMoveIds: ["72", "71", "72"], destinationQuantId: "37" }
  assert.deepEqual(manufacturingResultLinks(ref).map(({ resource, id }) => [resource, id]), [
    ["mrp-productions", "99"], ["stock-moves", "72"], ["stock-moves", "71"], ["stock-quants", "37"],
  ])
  assert.equal(manufacturingResultLinks(ref)[0]?.href, "/manufacturing?tab=orders&filter=id%3A99")
  assert.equal(manufacturingResultLinks(ref)[3]?.href, "/inventory?tab=stock&filter=id%3A37")
})

test("record navigation preserves large u64 identity and ignores arbitrary hrefs", () => {
  assert.equal(manufacturingResultLinks({ resource: "stock-moves", id: "18446744073709551615", href: "/api/query/stock-moves" })[0]?.href,
    "/inventory?tab=stock-moves&filter=id%3A18446744073709551615")
  assert.deepEqual(manufacturingResultLinks({ resource: "unknown", id: "71", href: "https://untrusted.example" }), [])
  for (const id of ["0", "-1", "NaN", "18446744073709551616", "71/other"]) {
    assert.deepEqual(manufacturingResultLinks({ resource: "stock-moves", id }), [])
  }
})

test("legacy, failed or unresolved record-page outcomes never produce a success link", () => {
  for (const outcome of [undefined, null, {}, { kind: "rejected" }, { kind: "outcome-unknown" }, { kind: "converged", ref: null }]) {
    assert.deepEqual(resolvedManufacturingResultLinks(outcome), [])
  }
  assert.equal(resolvedManufacturingResultLinks({ kind: "converged", ref: { resource: "mrp-productions", id: "3" } })[0]?.id, "3")
})
