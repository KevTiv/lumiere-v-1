import assert from "node:assert/strict"
import test from "node:test"

import {
  INVENTORY_QUERY_RESOURCES,
  PICKING_ORDER_RESOURCES,
  PICKING_TRANSITION_AFFECTS,
  observeValidatedPicking,
  packPickingAction,
  partialValidatePickingAction,
  isPickingActionApplicable,
  isPickingActionApplicableToAll,
  pickingStateTag,
  planPartialDelivery,
} from "./fulfillment"

test("picking actions follow the draft → confirmed → assigned → done machine", () => {
  assert.ok(isPickingActionApplicable("confirm", { state: "draft" }))
  assert.ok(!isPickingActionApplicable("confirm", { state: "confirmed" }))
  assert.ok(isPickingActionApplicable("assign", { state: "confirmed" }))
  assert.ok(!isPickingActionApplicable("assign", { state: "draft" }))
  assert.ok(isPickingActionApplicable("validate", { state: "assigned" }))
  assert.ok(isPickingActionApplicable("partial-validate", { state: "assigned" }))
  assert.ok(!isPickingActionApplicable("validate", { state: "confirmed" }))
})

test("terminal pickings offer no action", () => {
  for (const state of ["done", "cancel", "cancelled"]) {
    for (const action of ["confirm", "assign", "validate", "cancel", "assign-user"] as const) {
      assert.ok(!isPickingActionApplicable(action, { state }), `${action} on ${state}`)
    }
  }
})

test("state tag is case-insensitive and tolerates missing state", () => {
  assert.equal(pickingStateTag({ state: "Assigned" }), "assigned")
  assert.equal(pickingStateTag({}), "")
})

test("multi-selection requires every row to qualify", () => {
  const rows = [{ state: "assigned" }, { state: "confirmed" }]
  assert.ok(!isPickingActionApplicableToAll("validate", rows))
  assert.ok(isPickingActionApplicableToAll("validate", [rows[0]!]))
  assert.ok(!isPickingActionApplicableToAll("validate", []))
})

test("partial delivery records only short-shipped moves", () => {
  const plan = planPartialDelivery(
    [
      { moveId: "1", orderedQty: 10 },
      { moveId: "2", orderedQty: 5 },
    ],
    { qty_1: "6", qty_2: 5 },
  )
  assert.deepEqual(plan, { ok: true, shortMoves: [{ moveId: "1", quantityDone: 6 }] })
})

test("partial delivery rejects zero, over-delivery and blanks", () => {
  const lines = [{ moveId: "1", orderedQty: 10 }]
  assert.deepEqual(planPartialDelivery(lines, { qty_1: 0 }), { ok: false, error: "invalidQty" })
  assert.deepEqual(planPartialDelivery(lines, { qty_1: 11 }), { ok: false, error: "invalidQty" })
  assert.deepEqual(planPartialDelivery(lines, { qty_1: "" }), { ok: false, error: "qtyRequired" })
  assert.deepEqual(planPartialDelivery(lines, {}), { ok: false, error: "qtyRequired" })
})

test("packing is offered only for an assigned picking", () => {
  assert.ok(isPickingActionApplicable("pack", { state: "assigned" }))
  for (const state of ["draft", "confirmed", "done", "cancel"]) {
    assert.ok(!isPickingActionApplicable("pack", { state }), state)
  }
})

test("a picking transition refreshes stock and the orders that originated it", () => {
  for (const resource of ["stock-pickings", "stock-moves", "stock-quants", "products", ...PICKING_ORDER_RESOURCES]) {
    assert.ok((PICKING_TRANSITION_AFFECTS as readonly string[]).includes(resource), resource)
  }
  assert.equal(new Set(INVENTORY_QUERY_RESOURCES).size, INVENTORY_QUERY_RESOURCES.length, "no duplicates")
})

test("validating with a backorder links the newest backorder picking, keeping the sales context", () => {
  const observed = observeValidatedPicking("5", [
    { id: 5, saleId: 2, state: "done" },
    { id: 8, backorderId: 5, saleId: 2 },
    { id: 9, backorderId: 5, saleId: 2 },
    { id: 10, backorderId: 6 },
  ])
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.createdRecords?.map((r) => r.id), ["9", "8"])
  assert.deepEqual(observed.createdRecords?.[0], { resource: "stock_picking", id: "9", module: "inventory", context: "sales" })
  assert.equal(observed.next, undefined)
})

test("validating in full claims no created record, and an unknown picking claims nothing", () => {
  assert.deepEqual(observeValidatedPicking("5", [{ id: 5, state: "done" }]), { outcome: "applied" })
  assert.deepEqual(observeValidatedPicking("5", []), {})
})

test("pack is an immediate record action; partial validation is form-backed and gated on assigned", async () => {
  let packed: string | undefined
  const pack = packPickingAction({
    label: "Pack",
    execute: async (id) => {
      packed = id
      return { outcome: "applied", affectedResources: [] }
    },
  })
  assert.equal(pack.kind, "immediate")
  assert.ok(pack.canPresent({ id: 3, state: "assigned" }))
  await pack.execute(pack.prepare!({ id: 3, state: "assigned" }))
  assert.equal(packed, "3")

  const partial = partialValidatePickingAction({ label: "Partial", execute: async () => ({ outcome: "applied", affectedResources: [] }) })
  assert.equal(partial.kind, "form")
  assert.ok(partial.canPresent({ state: "assigned" }))
  assert.ok(!partial.canPresent({ state: "confirmed" }))
})
