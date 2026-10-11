import assert from "node:assert/strict"
import test from "node:test"
import type { ManufacturingMutations } from "@lumiere/query-hooks/hooks/manufacturing"
import { submitManufacturingRowAction } from "./manufacturing-row-action-submit"

test("row submit returns exact canonical results for output, close, scrap and byproduct", async () => {
  for (const [tab, field, action, mutation, values, resource] of [
    ["orders", "moAction", "produce", "produceMo", { moRecordId: "3", produceQty: 1 }, "mrp-productions"],
    ["orders", "moAction", "finish", "finishMo", { moRecordId: "3" }, "mrp-productions"],
    ["orders", "moAction", "scrap_output", "scrapFinishedOutput", { moRecordId: "3", scrapLocationId: "4", scrapQuantity: 1 }, "stock-moves"],
    ["boms", "bomAction", "add_byproduct", "createBomByproduct", { bomRecordId: "3", byproductProductId: "4", byproductUomId: "5", byproductQuantity: 1, byproductCostShare: 20 }, "mrp-bom-byproducts"],
  ] as const) {
    const outcome = { kind: "already-applied", ref: { resource, id: "19" } } as const
    let calls = 0
    const mutations = { [mutation]: { mutateAsync: async () => { calls++; return outcome } } } as unknown as ManufacturingMutations
    assert.equal(await submitManufacturingRowAction(tab, { ...values, [field]: action }, mutations), outcome)
    assert.equal(calls, 1)
  }
})

test("denied or unresolved mutation errors propagate without success results", async () => {
  const denied = new Error("Access denied")
  const mutations = { finishMo: { mutateAsync: async () => { throw denied } } } as unknown as ManufacturingMutations
  await assert.rejects(submitManufacturingRowAction("orders", { moAction: "finish", moRecordId: "3" }, mutations), error => error === denied)
})
