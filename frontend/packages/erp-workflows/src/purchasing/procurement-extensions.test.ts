import assert from "node:assert/strict"
import test from "node:test"

import {
  approveSupplierIntakeAction,
  holdSupplierIntakeAction,
  isBlanketReleasable,
  isIntakeApprovable,
  isIntakeRejectable,
  isIntakeReviewable,
  isLandedCostApplicable,
  isLandedCostDraft,
  isPurchaseReturnConfirmable,
  isPurchaseReturnCreditable,
  observeBlanketRelease,
  observeLandedCostApplied,
  observeConfirmedPurchaseReturn,
  observeReturnVendorCredit,
  reviewSupplierIntakeAction,
} from "./procurement-extensions"

const noop = async () => ({ outcome: "applied" as const, affectedResources: [] })

test("intake review/approve/hold/reject gates mirror the reducers, including enum-shaped state", () => {
  assert.ok(isIntakeReviewable({ state: "Submitted" }))
  assert.ok(isIntakeReviewable({ state: { tag: "OnHold" } }))
  assert.ok(!isIntakeReviewable({ state: "UnderReview" }))
  assert.ok(isIntakeApprovable({ state: "UnderReview" }))
  assert.ok(isIntakeApprovable({ state: "Submitted" }))
  assert.ok(!isIntakeApprovable({ state: "OnHold" }))
  assert.ok(isIntakeRejectable({ state: "OnHold" }))
  for (const state of ["Approved", "Rejected", "Onboarded"]) assert.ok(!isIntakeRejectable({ state }), state)
})

test("intake dispatch prepares the row's ids, the partner and a default reason", () => {
  const row = { id: 4, partnerId: 9, state: "UnderReview" }
  assert.deepEqual(reviewSupplierIntakeAction({ label: "Review", execute: noop }).prepare?.(row), { intakeId: "4" })
  assert.deepEqual(approveSupplierIntakeAction({ label: "Approve", execute: noop }).prepare?.(row), {
    intakeId: "4",
    partnerId: "9",
  })
  // No linked partner yet: an empty id lets the command report a typed validation error.
  assert.equal(approveSupplierIntakeAction({ label: "Approve", execute: noop }).prepare?.({ id: 5 }).partnerId, "")
  assert.deepEqual(
    holdSupplierIntakeAction({ label: "Hold", defaultReason: "Held", execute: noop }).prepare?.(row),
    { intakeId: "4", reason: "Held" },
  )
})

test("landed cost compute/post/cancel need a draft; apply needs a posted one", () => {
  assert.ok(isLandedCostDraft({ state: "Draft" }))
  assert.ok(!isLandedCostDraft({ state: { tag: "Posted" } }))
  assert.ok(isLandedCostApplicable({ state: "Posted" }))
  assert.ok(!isLandedCostApplicable({ state: "Draft" }))
})

test("purchase return confirm needs draft; a vendor credit needs confirmed and none yet", () => {
  assert.ok(isPurchaseReturnConfirmable({ state: "draft" }))
  assert.ok(!isPurchaseReturnConfirmable({ state: "confirmed" }))
  assert.ok(isPurchaseReturnCreditable({ state: "confirmed" }))
  assert.ok(!isPurchaseReturnCreditable({ state: "confirmed", creditMoveId: 3 }))
  assert.ok(!isPurchaseReturnCreditable({ state: "draft" }))
})

test("a confirmed return opens its return picking and a vendor credit opens in accounting", () => {
  const picking = { resource: "stock_picking", id: "31", module: "inventory", context: "purchasing" }
  assert.deepEqual(observeConfirmedPurchaseReturn("2", [{ id: 2, pickingId: 31 }]).next, picking)
  assert.deepEqual(observeConfirmedPurchaseReturn("2", [{ id: 2 }]), {})
  const credit = { resource: "account_move", id: "44", module: "accounting", context: "purchasing" }
  assert.deepEqual(observeReturnVendorCredit("2", [{ id: 2, creditMoveId: 44 }]).createdRecords, [credit])
  assert.deepEqual(observeReturnVendorCredit("2", [{ id: 2, credit_move_id: null }]), {})
})

test("only draft blankets release, and the release is the exact (blanket, idempotency key) row", () => {
  assert.ok(isBlanketReleasable({ state: "draft" }))
  assert.ok(!isBlanketReleasable({ state: "closed" }))
  const orders = [
    { id: 10, origin: "blanket:7" },
    { id: 12, origin: "blanket:7" },
    { id: 13, origin: "blanket:70" },
  ]
  const releases = [
    { id: 1, blanketOrderId: 7, idempotencyKey: "rel-a", purchaseOrderId: 10 },
    { id: 2, blanket_order_id: 7, idempotency_key: "rel-b", purchase_order_id: 12 },
  ]
  const observed = observeBlanketRelease("7", " rel-a ", releases, orders)
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "10", module: "purchasing" })
  assert.deepEqual(observed.createdRecords, [observed.next])
  assert.equal(observeBlanketRelease("7", "rel-b", releases, orders).next?.id, "12")
  assert.deepEqual(observeBlanketRelease("7", "rel-c", releases, orders), {})
  assert.deepEqual(observeBlanketRelease("70", "rel-a", releases, orders), {})
  assert.deepEqual(
    observeBlanketRelease("7", "rel-a", [...releases, { id: 3, blanketOrderId: 7, idempotencyKey: "rel-a", purchaseOrderId: 12 }], orders),
    {},
  )
  assert.deepEqual(
    observeBlanketRelease("7", "x", [{ blanketOrderId: 7, idempotencyKey: "x", purchaseOrderId: 13 }], orders),
    {},
  )
  assert.deepEqual(observeBlanketRelease("7", "rel-a", releases, []), {})
})

test("a landed cost apply is confirmed by its one committed application row", () => {
  assert.deepEqual(observeLandedCostApplied("4", [{ id: 1, landedCostId: 4 }, { id: 2, landed_cost_id: 5 }]), {
    outcome: "applied",
    next: { resource: "stock_landed_cost", id: "4", module: "purchasing" },
  })
  assert.deepEqual(observeLandedCostApplied("4", [{ id: 2, landedCostId: 5 }]), {})
  assert.deepEqual(observeLandedCostApplied("4", [{ id: 1, landedCostId: 4 }, { id: 3, landedCostId: 4 }]), {})
})
