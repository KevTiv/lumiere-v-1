import assert from "node:assert/strict"
import test from "node:test"

import { pickingStepsToDone } from "../inventory/fulfillment"
import {
  isReturnCancellable,
  isReturnConfirmable,
  isReturnCreditable,
  exchangeSourceReturnId,
  isReturnExchangeable,
  isReturnReceivable,
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

test("the newest exchange order created from this return is opened", () => {
  const observed = observeExchangeOrder("3", [
    { id: 10, origin: "exchange:RMA/3" },
    { id: 12, metadata: '{"exchange_return_id":3}' },
    { id: 13, origin: "exchange:RMA/30" },
    { id: 14, metadata: '{"exchange_return_id":30}' },
  ])
  assert.deepEqual(observed.next, { resource: "sale_order", id: "12", module: "sales" })
  assert.deepEqual(observeExchangeOrder("3", []), {})
})

test("a picking is taken to done only through the steps it has not passed", () => {
  assert.deepEqual(pickingStepsToDone({ state: "draft" }), ["confirm", "assign", "validate"])
  assert.deepEqual(pickingStepsToDone({ state: "assigned" }), ["validate"])
  assert.deepEqual(pickingStepsToDone({ state: "done" }), [])
  assert.equal(pickingStepsToDone({ state: "cancel" }), undefined)
})
