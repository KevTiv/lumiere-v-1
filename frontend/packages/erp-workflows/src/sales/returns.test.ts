import assert from "node:assert/strict"
import test from "node:test"

import { pickingStepsToDone } from "../inventory/fulfillment"
import { resolveRecordLocation } from "../core/record-ref"
import {
  isReturnCancellable,
  isReturnConfirmable,
  isReturnCreditable,
  exchangeSourceReturnId,
  isReturnExchangeable,
  isReturnReceivable,
  CREATE_RETURN_ORDER_AFFECTS,
  createReturnOrderAction,
  observeCreatedReturnOrder,
  returnExchangeOrderIds,
  observeConfirmedReturn,
  observeExchangeOrder,
  observeReturnCreditNote,
} from "./returns"

test("return actions follow draft → confirmed → received → refunded", () => {
  assert.ok(isReturnConfirmable({ state: "draft" }))
  assert.ok(!isReturnConfirmable({ state: "confirmed" }))
  assert.ok(isReturnReceivable({ state: "confirmed", pickingId: 9 }))
  assert.ok(!isReturnReceivable({ state: "confirmed" }))
  assert.ok(isReturnCreditable({ state: "received" }))
  assert.ok(!isReturnCreditable({ state: "received", creditMoveId: 4 }))
  assert.ok(!isReturnCreditable({ state: "refunded" }))
  assert.ok(isReturnExchangeable({ state: "received" }) && isReturnExchangeable({ state: "confirmed" }))
  assert.ok(!isReturnExchangeable({ state: "draft" }))
})

test("only returns that have not yet received goods can be cancelled", () => {
  assert.ok(isReturnCancellable({ state: "draft" }) && isReturnCancellable({ state: "confirmed" }))
  for (const state of ["received", "refunded", "cancelled"]) assert.ok(!isReturnCancellable({ state }), state)
})

test("confirming a return links its picking without leaving the return", () => {
  const observed = observeConfirmedReturn("3", [{ id: 3, pickingId: 9 }])
  assert.deepEqual(observed.createdRecords, [{ resource: "stock_picking", id: "9", module: "inventory", context: "sales" }])
  assert.equal(observed.next, undefined)
  assert.deepEqual(observeConfirmedReturn("3", [{ id: 3 }]), {})
})

test("the credit note opens in Accounting", () => {
  const observed = observeReturnCreditNote("3", [{ id: 3, credit_move_id: 77 }])
  assert.deepEqual(observed.next, { resource: "account_move", id: "77", module: "accounting", context: "sales" })
  assert.deepEqual(observeReturnCreditNote("3", [{ id: 3 }]), {})
})

test("an exchange order is tied to its return by metadata or by origin", () => {
  assert.equal(exchangeSourceReturnId({ metadata: '{"exchange_return_id":3,"origin_so_id":8}' }), "3")
  assert.equal(exchangeSourceReturnId({ origin: "exchange:RMA/3" }), "3")
  // The structured stamp wins, and the fallback survives a metadata that is not JSON.
  assert.equal(exchangeSourceReturnId({ metadata: '{"exchange_return_id":4}', origin: "exchange:RMA/3" }), "4")
  assert.equal(exchangeSourceReturnId({ metadata: "note", origin: "exchange:RMA/3" }), "3")
  assert.equal(exchangeSourceReturnId({ origin: "SO0001" }), undefined)
  assert.equal(exchangeSourceReturnId({}), undefined)
})

test("the one exchange order added since the snapshot is opened, never the newest", () => {
  const orders = [
    { id: 10, origin: "exchange:RMA/3" },
    { id: 12, metadata: '{"exchange_return_id":3}' },
    { id: 13, origin: "exchange:RMA/30" },
  ]
  assert.deepEqual(returnExchangeOrderIds("3", orders), ["10", "12"])
  const observed = observeExchangeOrder("3", ["12"], orders)
  assert.deepEqual(observed.next, { resource: "sale_order", id: "10", module: "sales" })
  assert.deepEqual(observeExchangeOrder("3", ["10", "12"], orders), {})
  assert.deepEqual(observeExchangeOrder("3", [], orders), {})
  assert.deepEqual(observeExchangeOrder("3", [], []), {})
})

test("a picking is taken to done only through the steps it has not passed", () => {
  assert.deepEqual(pickingStepsToDone({ state: "draft" }), ["confirm", "assign", "validate"])
  assert.deepEqual(pickingStepsToDone({ state: "assigned" }), ["validate"])
  assert.deepEqual(pickingStepsToDone({ state: "done" }), [])
  assert.equal(pickingStepsToDone({ state: "cancel" }), undefined)
})

test("the return a keyed create produced is the one its creation row names, and it can be opened", () => {
  const returns = [{ id: 11 }, { id: 14 }]
  const creations = [
    { id: 1, idempotencyKey: "k-1", returnOrderId: 11 },
    { id: 2, idempotency_key: "k-2", return_order_id: 14 },
  ]
  const observed = observeCreatedReturnOrder(" k-1 ", creations, returns)
  const ref = { resource: "return_order", id: "11", module: "sales" }
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.createdRecords, [ref])
  assert.deepEqual(observed.next, ref)
  assert.deepEqual(resolveRecordLocation(ref), { module: "sales", tab: "returns", filter: { id: "11" } })
  assert.equal(observeCreatedReturnOrder("k-2", creations, returns).next?.id, "14")
})

test("an unknown, blank, duplicated or dangling key claims nothing", () => {
  const returns = [{ id: 11 }]
  assert.deepEqual(observeCreatedReturnOrder("k-9", [{ idempotencyKey: "k-1", returnOrderId: 11 }], returns), {})
  assert.deepEqual(observeCreatedReturnOrder(" ", [{ idempotencyKey: "", returnOrderId: 11 }], returns), {})
  assert.deepEqual(
    observeCreatedReturnOrder("k-1", [{ idempotencyKey: "k-1", returnOrderId: 11 }, { idempotencyKey: "k-1", returnOrderId: 11 }], returns),
    {},
  )
  assert.deepEqual(observeCreatedReturnOrder("k-1", [{ idempotencyKey: "k-1", returnOrderId: 99 }], returns), {})
})

test("creating a return is form-backed, offered against a confirmed order, and refreshes returns only", async () => {
  let seen: unknown
  const action = createReturnOrderAction<{ reason: string }>({
    label: "New return",
    execute: async (input) => {
      seen = input
      return { outcome: "applied", affectedResources: [] }
    },
  })
  assert.equal(action.kind, "form")
  assert.ok(action.canPresent({ state: "Sale" }))
  assert.ok(!action.canPresent({ state: "Draft" }))
  await action.execute({ saleOrderId: "5", params: { reason: "damaged" } })
  assert.deepEqual(seen, { saleOrderId: "5", params: { reason: "damaged" } })
  assert.deepEqual([...CREATE_RETURN_ORDER_AFFECTS], ["return-orders", "return-order-lines"])
})
