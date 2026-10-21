import assert from "node:assert/strict"
import test from "node:test"
import {
  buildManufacturingScrapIntent, buildTrackedCloseIntent, materialScrapOptions,
  outputIdentityOptions, outputTrackingRequirements, resolveTrackingCloseEffect,
  resolveTrackingScrapEffect, trackedOutputOptions,
  type ManufacturingTrackingSnapshot,
} from "./manufacturing-tracking-intent"

const organizationId = 1n, companyId = 2n
const order = { id: "18446744073709551614", organizationId: "1", companyId: "2", state: "ToClose",
  productId: "10", productQty: 1, productUomId: "1", bomId: "20", locationSrcId: "5", locationDestId: "6",
  moveFinishedIds: [], moveRawIds: [] }
const snapshot: ManufacturingTrackingSnapshot = {
  products: [{ id: "10", organizationId: "1", tracking: "lot", active: true, uomId: "1" },
    { id: "11", organizationId: "1", tracking: "serial", active: true, uomId: "1" },
    { id: "12", organizationId: "1", tracking: "none", active: true, uomId: "1" }],
  boms: [{ id: "20", organizationId: "1", companyId: "2", productQty: 1, byproductIds: ["21"], bomLineIds: ["22"] }],
  byproducts: [{ id: "21", organizationId: "1", companyId: "2", bomId: "20", productId: "11", productQty: 1, productUomId: "1" }],
  bomLines: [{ id: "22", organizationId: "1", companyId: "2", bomId: "20", productId: "12" }],
  lots: [{ id: "40", organizationId: "1", companyId: "2", productId: "10", isLocked: false, isScrap: false }],
  serials: [{ id: "50", organizationId: "1", companyId: "2", productId: "11", state: "free", locationId: null, isScrap: false }],
  moves: [], quants: [{ id: "70", organizationId: "1", companyId: "2", productId: "12", locationId: "5", availableQuantity: 2 }],
  locations: [{ id: "7", organizationId: "1", companyId: "2", active: true, scrapLocation: true }],
}
const selections = { primary: { lotId: "40" }, "21": { serialId: "50" } }
const output = { id: "80", organizationId: "1", companyId: "2", productionId: order.id,
  productId: "10", lotId: "40", state: "done", isDone: true, scrapped: false,
  locationDestId: "6", quantityDone: 1, reference: `MO/${order.id}` }

test("close requires explicit exact identities and preserves full u64 identity", () => {
  const intent = buildTrackedCloseIntent(order, snapshot, organizationId, companyId, selections)
  assert.equal(intent.moId, 18446744073709551614n)
  assert.equal(intent.params.lotId, 40n)
  assert.equal(intent.params.byproducts[0]?.serialId, 50n)
  assert.throws(() => buildTrackedCloseIntent(order, snapshot, organizationId, companyId, {}))
  assert.throws(() => buildTrackedCloseIntent(order, snapshot, organizationId, 3n, selections), /active company/)
})

test("selectors exclude other company, product, locked and previously placed identities", () => {
  const requirements = outputTrackingRequirements(order, snapshot, organizationId, companyId)
  const varied = { ...snapshot, serials: [...snapshot.serials,
    { ...snapshot.serials[0], id: "51", companyId: "3" },
    { ...snapshot.serials[0], id: "52", productId: "10" },
    { ...snapshot.serials[0], id: "53", isLocked: true },
    { ...snapshot.serials[0], id: "54", locationId: "6" }] }
  assert.deepEqual(outputIdentityOptions(requirements[1]!, varied, organizationId, companyId).map((row) => row.id), ["50"])
  assert.throws(() => buildTrackedCloseIntent(order, varied, organizationId, companyId,
    { ...selections, "21": { serialId: "51" } }))
})

test("unknown BOM relations and multiunit serial output cannot produce an intent", () => {
  assert.throws(() => outputTrackingRequirements(order, { ...snapshot, byproducts: [] }, organizationId, companyId), /ownership/)
  assert.throws(() => outputTrackingRequirements(order,
    { ...snapshot, byproducts: [{ ...snapshot.byproducts[0], productQty: 2 }] }, organizationId, companyId), /one unit/)
  assert.throws(() => outputTrackingRequirements(order,
    { ...snapshot, byproducts: [{ ...snapshot.byproducts[0], companyId: "3" }] }, organizationId, companyId), /company/)
})

test("scrap selects an owned output and excludes company-incompatible stock", () => {
  const done = { ...order, state: "Done", moveFinishedIds: ["80"] }
  const refs = { ...snapshot, moves: [output, { ...output, id: "81" }, { ...output, id: "82", companyId: "3" }] }
  assert.deepEqual(trackedOutputOptions(done, refs, organizationId, companyId).map((row) => row.id), ["80"])
  const intent = buildManufacturingScrapIntent("output", done, refs, organizationId, companyId, "80", "7", 0.4, "waste")
  assert.equal("outputMoveId" in intent && intent.outputMoveId, 80n)
  assert.throws(() => buildManufacturingScrapIntent("output", done, refs, organizationId, companyId, "81", "7", 0.4, "waste"))
  assert.throws(() => buildManufacturingScrapIntent("output", done, refs, organizationId, companyId, "80", "7", 2, "waste"), /exceeds/)
})

test("material waste selects available BOM stock only before consumption", () => {
  const progress = { ...order, state: "Progress" }
  assert.deepEqual(materialScrapOptions(progress, snapshot, organizationId, companyId).map((row) => row.id), ["70"])
  assert.deepEqual(materialScrapOptions({ ...progress, moveRawIds: ["80"] }, snapshot, organizationId, companyId), [])
  assert.throws(() => buildManufacturingScrapIntent("material", progress, snapshot, organizationId, companyId, "70", "7", 3, "waste"), /exceeds/)
  const intent = buildManufacturingScrapIntent("material", progress, snapshot, organizationId, companyId, "70", "7", 0.5, "waste")
  assert.equal("sourceQuantId" in intent && intent.sourceQuantId, 70n)
})

test("scrap bounds cumulative exact output waste and rejects fractional serials", () => {
  const done = { ...order, state: "Done", moveFinishedIds: ["80"] }
  const waste = { ...output, id: "90", scrapped: true, quantityDone: 0.8, metadata: '{"source_output_move_id":"80"}' }
  assert.throws(() => buildManufacturingScrapIntent("output", done, { ...snapshot, moves: [output, waste] },
    organizationId, companyId, "80", "7", 0.4, "more"), /exceeds/)
  const serialOutput = { ...output, lotId: undefined, serialId: "50", productId: "11" }
  assert.throws(() => buildManufacturingScrapIntent("output", done, { ...snapshot, moves: [serialOutput] },
    organizationId, companyId, "80", "7", 0.5, "fractional"), /one exact unit/)
})

test("close readback requires every exact attributed output before navigation", () => {
  const intent = buildTrackedCloseIntent(order, snapshot, organizationId, companyId, selections)
  const done = { ...order, state: "Done", moveFinishedIds: ["80", "81"] }
  const byproduct = { ...output, id: "81", productId: "11", lotId: undefined, serialId: "50", reference: `MO/${order.id}/BYPRODUCT/21` }
  assert.equal(resolveTrackingCloseEffect(order, snapshot, organizationId, companyId, intent, [done], [output]), null)
  assert.deepEqual(resolveTrackingCloseEffect(order, snapshot, organizationId, companyId, intent, [done], [output, byproduct])?.finishedMoveIds, ["80", "81"])
  assert.throws(() => resolveTrackingCloseEffect(order, snapshot, organizationId, companyId, intent, [done], [output, { ...byproduct, serialId: "51" }]), /attribution/)
})

test("scrap readback resolves only one exact request with durable source identity", () => {
  const done = { ...order, state: "Done", moveFinishedIds: ["80"] }
  const intent = buildManufacturingScrapIntent("output", done, { ...snapshot, moves: [output] }, organizationId, companyId, "80", "7", 0.4, "waste")
  const effect = { ...output, id: "90", scrapped: true, quantityDone: 0.4, locationDestId: "7",
    reference: `MO/${order.id}/SCRAP/waste`, metadata: JSON.stringify({ source_output_move_id: "80" }) }
  assert.equal(resolveTrackingScrapEffect("output", done, organizationId, companyId, intent, []) , null)
  assert.equal(resolveTrackingScrapEffect("output", done, organizationId, companyId, intent, [effect])?.id, "90")
  assert.throws(() => resolveTrackingScrapEffect("output", done, organizationId, companyId, intent, [effect, { ...effect, id: "91" }]), /ambiguous/)
  assert.throws(() => resolveTrackingScrapEffect("output", done, organizationId, companyId, intent, [{ ...effect, metadata: '{}' }]), /exact/)
})
