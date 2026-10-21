import assert from "node:assert/strict"
import test from "node:test"

import { buildTaskStateCommand } from "./task-state-command"

test("task moves send HTTP unit variants for every board state", () => {
  for (const [tag, wire] of [
    ["Cancelled", "cancelled"],
    ["InProgress", "inProgress"],
    ["Done", "done"],
    ["Approved", "approved"],
    ["ChangesRequested", "changesRequested"],
  ]) {
    for (const state of [tag, { tag }]) {
      const { urlPath, init } = buildTaskStateCommand("42", state)
      assert.equal(urlPath, "/api/operations/erp.update_task_state")
      assert.deepEqual(JSON.parse(String(init.body)), { taskId: "42", state: { [wire]: [] } })
    }
  }
})

test("task moves retain large task IDs without losing precision", () => {
  const { init } = buildTaskStateCommand("9007199254740993", "Approved")
  assert.equal(JSON.parse(String(init.body)).taskId, "9007199254740993")
})

test("unknown or missing task states cannot be dispatched", () => {
  for (const state of [null, undefined, "approved", "Unknown", {}, { tag: "Unknown" }]) {
    assert.throws(() => buildTaskStateCommand(42, state), /Invalid task state/)
  }
})
