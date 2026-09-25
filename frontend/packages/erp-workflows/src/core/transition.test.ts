import assert from "node:assert/strict"
import test from "node:test"

import { createFakeCompletionPorts } from "../testing"
import { WorkflowError } from "./errors"
import { recordRef, resolveRecordLocation } from "./record-ref"
import { completeTransition, createSingleFlight, type TransitionSpec } from "./transition"

const spec = (overrides: Partial<TransitionSpec<string>> = {}): TransitionSpec<string> => ({
  id: "test.transition",
  command: async () => undefined,
  affects: ["sale-orders", "stock-pickings"],
  ...overrides,
})

test("success invalidates declared resources, observes state and navigates to next", async () => {
  const fake = createFakeCompletionPorts()
  const picking = recordRef("stock_picking", 7)
  const result = await completeTransition(
    spec({ observe: async () => ({ createdRecords: [picking], next: picking }) }),
    "1",
    fake.ports,
    { navigateToNext: true },
  )
  assert.deepEqual(fake.invalidated, [["sale-orders", "stock-pickings"]])
  assert.deepEqual(result.createdRecords, [picking])
  assert.deepEqual(fake.navigated, [picking])
  assert.equal(fake.notices[0]?.kind, "success")
})

test("navigation is opt-in", async () => {
  const fake = createFakeCompletionPorts()
  const picking = recordRef("stock_picking", 7)
  await completeTransition(spec({ observe: async () => ({ next: picking }) }), "1", fake.ports)
  assert.deepEqual(fake.navigated, [])
})

test("an accepted-but-unapplied command reports approval pending, not success", async () => {
  const fake = createFakeCompletionPorts()
  const result = await completeTransition(
    spec({ observe: async () => ({ outcome: "approval_pending" }) }),
    "1",
    fake.ports,
  )
  assert.equal(result.outcome, "approval_pending")
  assert.equal(fake.notices[0]?.kind, "info")
})

test("a check that failed before reaching the server does not invalidate, notifies, and rethrows a typed error", async () => {
  const fake = createFakeCompletionPorts()
  await assert.rejects(
    completeTransition(
      spec({ command: async () => { throw new WorkflowError("validation", "companyId is required") } }),
      "1",
      fake.ports,
    ),
    (error: unknown) => error instanceof WorkflowError && error.kind === "validation",
  )
  assert.deepEqual(fake.invalidated, [])
  assert.equal(fake.notices[0]?.kind, "error")
})

test("response-lost failures still converge on canonical state", async () => {
  const fake = createFakeCompletionPorts()
  await assert.rejects(
    completeTransition(
      spec({ command: async () => { throw new TypeError("fetch failed") } }),
      "1",
      fake.ports,
    ),
    (error: unknown) => error instanceof WorkflowError && error.kind === "outcome_unknown",
  )
  assert.deepEqual(fake.invalidated, [["sale-orders", "stock-pickings"]])
})

test("a failing canonical readback cannot be reported as applied", async () => {
  const fake = createFakeCompletionPorts()
  await assert.rejects(
    completeTransition(
      spec({ observe: async () => { throw new Error("readback failed") } }),
      "1",
      fake.ports,
    ),
    (error: unknown) =>
      error instanceof WorkflowError && error.kind === "outcome_unknown",
  )
  assert.equal(fake.notices[0]?.kind, "error")
  assert.equal(fake.notices[0]?.error?.kind, "outcome_unknown")
})

test("single-flight collapses concurrent runs and releases afterwards", async () => {
  const flight = createSingleFlight()
  let calls = 0
  const run = () => flight.run("order:1", async () => { calls += 1; await Promise.resolve() })
  await Promise.all([run(), run()])
  assert.equal(calls, 1)
  assert.equal(flight.isRunning("order:1"), false)
  await run()
  assert.equal(calls, 2)
})

test("record refs resolve to the owning module tab filtered to the record", () => {
  assert.deepEqual(resolveRecordLocation(recordRef("stock_picking", 9)), {
    module: "inventory",
    tab: "transfers",
    filter: { id: "9" },
  })
  assert.equal(recordRef("sale_order", 1).module, "sales")
  assert.equal(resolveRecordLocation(recordRef("unknown_table", 1)), undefined)
})

test("a sales-context delivery falls back to Sales fulfillment when Inventory is not accessible", () => {
  const delivery = recordRef("stock_picking", 9, "inventory", "sales")
  const location = (modules: string[]) =>
    resolveRecordLocation(delivery, { canAccess: (m) => modules.includes(m) })
  assert.equal(location(["inventory", "sales"])?.module, "inventory")
  assert.deepEqual(location(["sales"]), { module: "sales", tab: "fulfillment", filter: { id: "9" } })
  assert.equal(location([]), undefined)
})

test("the contextual fallback is offered only to the module that produced the ref", () => {
  const receipt = recordRef("stock_picking", 9, "inventory", "purchasing")
  assert.equal(resolveRecordLocation(receipt, { canAccess: (m) => m === "sales" }), undefined)
  assert.equal(resolveRecordLocation(recordRef("stock_picking", 9), { canAccess: (m) => m === "sales" }), undefined)
})
