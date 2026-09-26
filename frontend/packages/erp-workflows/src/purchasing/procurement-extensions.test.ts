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

test("only draft blankets release, and the newest PO stamped blanket:<id> is the release", () => {
  assert.ok(isBlanketReleasable({ state: "draft" }))
  assert.ok(!isBlanketReleasable({ state: "closed" }))
  const observed = observeBlanketRelease("7", [
    { id: 10, origin: "blanket:7" },
    { id: 12, origin: "blanket:7" },
    { id: 13, origin: "blanket:70" },
    { id: 14, origin: "requisition:7" },
  ])
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "12", module: "purchasing" })
  assert.deepEqual(observeBlanketRelease("8", []), {})
})
