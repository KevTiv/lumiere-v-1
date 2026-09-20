import assert from "node:assert/strict"
import test from "node:test"

import {
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
