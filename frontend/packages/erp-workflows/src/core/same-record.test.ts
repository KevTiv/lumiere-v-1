import assert from "node:assert/strict"
import test from "node:test"

import { recordRef } from "./record-ref"
import { observeSameRecord, stateIs } from "./same-record"

const ref = recordRef("sale_order", 5, "sales")

test("the same record in the expected state confirms an in-place transition", () => {
  assert.deepEqual(observeSameRecord(ref, [{ id: 5, state: { tag: "Cancelled" } }], stateIs("Cancelled")), {
    outcome: "applied",
    next: ref,
  })
  assert.deepEqual(observeSameRecord(ref, [{ id: 5, state: "in_progress" }], stateIs("InProgress")).outcome, "applied")
})

test("another state, another record, or no record is unresolved", () => {
  assert.deepEqual(observeSameRecord(ref, [{ id: 5, state: "Draft" }], stateIs("Cancelled")), {})
  assert.deepEqual(observeSameRecord(ref, [{ id: 6, state: "Cancelled" }], stateIs("Cancelled")), {})
  assert.deepEqual(observeSameRecord(ref, [], stateIs("Cancelled")), {})
})
