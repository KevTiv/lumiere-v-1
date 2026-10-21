import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { bankSettlementAttempt, bankSettlementPendingReversalRequest, bankSettlementRecoveryAllowed, bankSettlementRecoveryCorrelates, bankSettlementRecoveryRequest } from "./bank-settlement-lifecycle"

const facts = { attemptId: "attempt-1", generation: "1", paymentId: "50", selectedMoveLineIds: ["91", "92"], status: "approval_rejected", selectedResiduals: [{ lineId: "91", residual: 60 }, { lineId: "92", residual: 40 }] }
const context = { organizationId: "7", companyId: "8", statementId: "31", lineId: "41" }
describe("bank settlement lifecycle review", () => {
  it("strictly decodes immutable public hints without inventing unavailable snapshot amounts", () => {
    const attempt = bankSettlementAttempt(JSON.stringify({ bankSettlement: facts }))!
    assert.equal(attempt.paymentId, "50")
    assert.equal(Object.isFrozen(attempt), true)
    assert.equal(Object.isFrozen(attempt.selectedResiduals?.[0]), true)
    assert.equal(bankSettlementAttempt({ bankSettlement: { ...facts, selectedResiduals: undefined } })?.selectedResiduals, undefined)
    for (const patch of [{ selectedMoveLineIds: ["91", "91"] }, { paymentId: Number.MAX_SAFE_INTEGER + 1 }, { status: "guessed" }, { selectedResiduals: [{ lineId: "91", residual: null }, { lineId: "92", residual: 40 }] }, { selectedResiduals: [{ lineId: "91", residual: 60 }] }]) {
      assert.equal(bankSettlementAttempt({ bankSettlement: { ...facts, ...patch } }), null)
    }
  })
  it("only permits closed drafts to be abandoned or resubmitted", () => {
    const attempt = bankSettlementAttempt({ bankSettlement: facts })!
    assert.equal(bankSettlementRecoveryAllowed(attempt, "abandon"), true)
    assert.equal(bankSettlementRecoveryAllowed({ ...attempt, status: "awaiting_approval" }, "abandon"), false)
    assert.equal(bankSettlementRecoveryAllowed({ ...attempt, status: "payment_posted" }, "resubmit"), false)
    assert.equal(bankSettlementRecoveryAllowed({ ...attempt, status: "settled" }, "reverse"), true)
    assert.equal(bankSettlementRecoveryAllowed({ ...attempt, status: "reversal_awaiting_approval" }, "reverse"), false)
  })
  it("freezes a reviewed reason, date, IDs and key and rejects invalid dates or missing review", () => {
    const attempt = bankSettlementAttempt({ bankSettlement: { ...facts, status: "settled" } })!
    const request = bankSettlementRecoveryRequest(context, attempt, { action: "reverse", reason: "Wrong bank receipt", date: "2026-10-18", idempotencyKey: "immutable-1" })!
    assert.equal(request.dateMicros, "1792281600000000")
    assert.equal(Object.isFrozen(request), true)
    assert.equal(Object.isFrozen(request.moveLineIds), true)
    for (const date of [undefined, "2026-02-30", "18/10/2026"]) assert.equal(bankSettlementRecoveryRequest(context, attempt, { action: "reverse", reason: "Reviewed reason", date, idempotencyKey: "immutable-1" }), null)
    assert.equal(bankSettlementRecoveryRequest(context, attempt, { action: "reverse", reason: " ", date: "2026-10-18", idempotencyKey: "immutable-1" }), null)
  })
  it("correlates readback with the exact recovery key, original payment, selection and reversal date", () => {
    const attempt = bankSettlementAttempt({ bankSettlement: facts })!
    const request = bankSettlementRecoveryRequest(context, attempt, { action: "resubmit", reason: "Approval scope corrected", idempotencyKey: "resubmit-1" })!
    const successor = { ...attempt, attemptId: "attempt-2", paymentId: "51", previousPaymentId: "50", recoveryAction: "resubmit" as const, recoveryKey: "resubmit-1", recoveryReason: "Approval scope corrected" }
    assert.equal(bankSettlementRecoveryCorrelates(successor, request), true)
    for (const patch of [{ recoveryKey: "other" }, { previousPaymentId: "49" }, { selectedMoveLineIds: ["91"] }]) assert.equal(bankSettlementRecoveryCorrelates({ ...successor, ...patch }, request), false)
  })
  it("captures a fresh reviewed resubmission selection independently from the closed draft", () => {
    const attempt = bankSettlementAttempt({ bankSettlement: facts })!
    const request = bankSettlementRecoveryRequest(context, attempt, { action: "resubmit", reason: "Current invoice selection reviewed", idempotencyKey: "new-selection", moveLineIds: ["100", "101"] })!
    assert.deepEqual(request.moveLineIds, ["100", "101"])
    assert.deepEqual(attempt.selectedMoveLineIds, ["91", "92"])
    assert.equal(bankSettlementRecoveryRequest(context, attempt, { action: "resubmit", reason: "Current invoice selection reviewed", idempotencyKey: "new-selection", moveLineIds: ["100", "100"] }), null)
  })
  it("reconstructs only complete persisted reversal parameters after approval waiting", () => {
    const attempt = bankSettlementAttempt({ bankSettlement: { ...facts, status: "reversal_awaiting_approval", recoveryAction: "reverse", recoveryKey: "original-reverse", reversalReason: "Original reviewed reason", reversalDateMicros: "1792281600000000" } })!
    const request = bankSettlementPendingReversalRequest(context, attempt)!
    assert.equal(request.idempotencyKey, "original-reverse")
    assert.equal(request.reason, "Original reviewed reason")
    assert.equal(Object.isFrozen(request), true)
    assert.equal(bankSettlementPendingReversalRequest(context, { ...attempt, reversalReason: undefined }), null)
    assert.equal(bankSettlementPendingReversalRequest(context, { ...attempt, reversalDateMicros: "1792281600000001" }), null)
  })
})
