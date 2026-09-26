import assert from "node:assert/strict"
import test from "node:test"

import {
  SALE_ORDER_LINE_AFFECTS,
  createSaleOrderLineAction,
  deleteSaleOrderLineAction,
  updateSaleOrderLineAction,
} from "./order-lines"

test("every line mutation also refreshes the order, whose totals the reducer recomputes", () => {
  assert.deepEqual([...SALE_ORDER_LINE_AFFECTS].sort(), ["sale-order-lines", "sale-orders"])
})

test("create and update are form-backed and carry the order or line they target", async () => {
  const seen: unknown[] = []
  const execute = async (input: unknown) => {
    seen.push(input)
    return { outcome: "applied" as const, affectedResources: [] }
  }
  const create = createSaleOrderLineAction<{ qty: number }>({ label: "Add", execute })
  const update = updateSaleOrderLineAction<{ qty: number }>({ label: "Edit", execute })
  assert.equal(create.kind, "form")
  assert.equal(update.kind, "form")
  await create.execute({ orderId: "4", params: { qty: 2 } })
  await update.execute({ lineId: "9", params: { qty: 3 } })
  assert.deepEqual(seen, [
    { orderId: "4", params: { qty: 2 } },
    { lineId: "9", params: { qty: 3 } },
  ])
})

test("delete is a destructive record action dispatched with the line id", async () => {
  let deleted: string | undefined
  const action = deleteSaleOrderLineAction({
    label: "Delete",
    execute: async (id) => {
      deleted = id
      return { outcome: "applied", affectedResources: [] }
    },
  })
  assert.equal(action.kind, "destructive")
  assert.ok(action.canPresent({ id: 9 }))
  await action.execute(action.prepare!({ id: 9 }))
  assert.equal(deleted, "9")
})
