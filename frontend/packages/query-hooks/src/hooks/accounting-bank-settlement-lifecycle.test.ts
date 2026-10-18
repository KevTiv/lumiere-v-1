import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { stdbBffCallUrl } from "@lumiere/stdb/commands"
import { bankSettlementAttempt, bankSettlementRecoveryRequest } from "@lumiere/erp-shared/bank-settlement-lifecycle"
import { resolveBankSettlementLifecycleEffect, type BankSettlementCanonicalRows } from "./accounting/bank-settlement-effect"
import { recoverBankStatementSettlement } from "./accounting/bank-statements"

const scope = { organizationId: "7", companyId: "8", lineId: "41" }
function fixture() {
  const common = { organizationId: "7", companyId: "8", currencyId: "3", partnerId: "4" }
  const attempt = { attemptId: "bank-41-attempt-1", generation: "1", paymentId: "50", selectedMoveLineIds: ["91", "93"],
    selectedResiduals: [{ lineId: "91", moveId: "70", residual: 60, residualCurrency: 0 }, { lineId: "93", moveId: "71", residual: 40, residualCurrency: 0 }], status: "settled", allocationApplied: true, paymentMoveId: "60" }
  const line = { id: "41", organizationId: "7", statementId: "31", journalId: "5", amount: 100, amountResidual: 0, isReconciled: true, paymentIds: ["50"], moveIds: ["91", "93"], metadata: { bankSettlement: attempt } }
  const statement = { id: "31", ...common, journalId: "5", state: "Open" }
  const payment = { id: "50", ...common, journalId: "5", amount: 100, paymentType: "Inbound", partnerType: "Customer", state: "Paid", moveId: "60" }
  const invoice = (id: string) => ({ id, ...common, journalId: "6", state: "Posted", moveType: "OutInvoice", paymentState: "Paid", amountTotal: 100, amountResidual: 0 })
  const originalMove = { id: "60", ...common, journalId: "5", state: "Posted", moveType: "Entry" }
  const target = (id: string, moveId: string) => ({ id, ...common, moveId, accountId: "401", parentState: "Posted", accountInternalType: "receivable", debit: 100, credit: 0, balance: 100, amountResidual: 0, amountResidualCurrency: 0, matchingNumber: `MATCH-60-${moveId}` })
  const clearing = { id: "92", ...common, moveId: "60", accountId: "401", parentState: "Posted", accountInternalType: "receivable", debit: 0, credit: 100, amountResidual: 0 }
  const liquidity = { id: "94", ...common, moveId: "60", accountId: "402", parentState: "Posted", accountInternalType: "liquidity", debit: 100, credit: 0, amountResidual: 0 }
  const rows: BankSettlementCanonicalRows = { lines: [line], statements: [statement], payments: [payment], moves: [invoice("70"), invoice("71"), originalMove], moveLines: [target("91", "70"), target("93", "71"), clearing, liquidity] }
  return { attempt, rows, common }
}
function openTargets(rows: BankSettlementCanonicalRows): BankSettlementCanonicalRows {
  return { ...rows,
    moves: rows.moves.map((row) => ["70", "71"].includes(String(row.id)) ? { ...row, amountResidual: row.id === "70" ? 60 : 40, paymentState: "Partial" } : row),
    moveLines: rows.moveLines.map((row) => ["91", "93"].includes(String(row.id)) ? { ...row, amountResidual: row.id === "91" ? 60 : 40, matchingNumber: undefined } : row),
  }
}
function reversedFixture() {
  const f = fixture()
  const attempt = { ...f.attempt, status: "reversed", reversalMoveId: "80", recoveryAction: "reverse", recoveryKey: "recovery-1", reversalDateMicros: "1792281600000000", reversalReason: "Wrong bank receipt" }
  const rows = openTargets(f.rows)
  const reversal = { id: "80", ...f.common, journalId: "5", state: "Posted", date: { microsSinceUnixEpoch: "1792281600000000" }, metadata: { reverses_payment_move_id: "60", account_payment_id: "50" } }
  const reversedRows: BankSettlementCanonicalRows = { ...rows,
    lines: [{ ...rows.lines[0], isReconciled: false, amountResidual: 100, moveIds: [], paymentIds: [], metadata: { bankSettlement: attempt } }],
    payments: [{ ...rows.payments[0], state: "Reversed", reversalMoveId: "80" }], moves: [...rows.moves, reversal],
    moveLines: [...rows.moveLines, ...rows.moveLines.filter((row) => row.moveId === "60").map((row, index) => ({ ...row, id: String(100 + index), moveId: "80", debit: row.credit, credit: row.debit }))],
  }
  return { ...f, attempt, rows: reversedRows }
}
describe("canonical bank settlement lifecycle effect", () => {
  it("requires complete financial facts before confirming a settled hint", () => {
    const f = fixture()
    assert.equal(resolveBankSettlementLifecycleEffect(f.rows, scope)?.status, "settled")
    for (const patch of [{ amountResidual: 60 }, { amountResidual: undefined }, { companyId: "9" }, { matchingNumber: "OTHER" }]) {
      assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, moveLines: [{ ...f.rows.moveLines[0], ...patch }, ...f.rows.moveLines.slice(1)] }, scope), null)
    }
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, moves: f.rows.moves.filter((row) => row.id !== "60") }, scope), null)
  })
  it("distinguishes closed unposted drafts and confirmed abandonment without changing invoices", () => {
    const f = fixture(), rows = openTargets(f.rows)
    const attempt = { ...f.attempt, status: "approval_rejected", allocationApplied: false, paymentMoveId: undefined }
    const draft = { ...rows, lines: [{ ...rows.lines[0], isReconciled: false, amountResidual: 100, moveIds: [], metadata: { bankSettlement: attempt } }],
      payments: [{ ...rows.payments[0], state: "NotPaid", moveId: undefined }], moves: rows.moves.filter((row) => row.id !== "60"), moveLines: rows.moveLines.filter((row) => row.moveId !== "60") }
    assert.equal(resolveBankSettlementLifecycleEffect(draft, scope)?.status, "approval_rejected")
    assert.equal(resolveBankSettlementLifecycleEffect({ ...draft, lines: [{ ...draft.lines[0], paymentIds: [], metadata: { bankSettlement: { ...attempt, status: "abandoned" } } }], payments: [{ ...draft.payments[0], state: "Reversed" }] }, scope)?.status, "abandoned")
    assert.equal(resolveBankSettlementLifecycleEffect({ ...draft, payments: [{ ...draft.payments[0], moveId: "60" }] }, scope), null)
  })
  it("keeps posted statements and financial balances unchanged during reversal approval", () => {
    const f = fixture()
    const attempt = { ...f.attempt, status: "reversal_awaiting_approval", reversalRequestId: "9", reversalDateMicros: "1792281600000000", recoveryAction: "reverse", recoveryKey: "recovery-1" }
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, statements: [{ ...f.rows.statements[0], state: "Posted" }], lines: [{ ...f.rows.lines[0], metadata: { bankSettlement: attempt } }] }, scope)?.status, "reversal_awaiting_approval")
  })
  it("proves exact compensation and restores the prior partial-payment residual, not the original total", () => {
    const f = reversedFixture()
    assert.equal(resolveBankSettlementLifecycleEffect(f.rows, scope)?.status, "reversed")
    const first = f.rows.moveLines[0]!
    assert.equal(first.balance, 100)
    assert.equal(first.amountResidual, 60)
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, moveLines: [{ ...first, amountResidual: 100 }, ...f.rows.moveLines.slice(1)] }, scope), null)
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, statements: [{ ...f.rows.statements[0], state: "Posted" }] }, scope), null)
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, moves: f.rows.moves.filter((row) => row.id !== "80") }, scope), null)
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, moveLines: f.rows.moveLines.map((row) => row.moveId === "80" ? { ...row, debit: 0, credit: 0 } : row) }, scope), null)
  })
  it("requires the exact saved request key and refuses duplicate, foreign or redacted readback", () => {
    const f = reversedFixture()
    const original = bankSettlementAttempt({ bankSettlement: { ...f.attempt, status: "settled" } })!
    const request = bankSettlementRecoveryRequest({ ...scope, statementId: "31" }, original, { action: "reverse", reason: "Wrong bank receipt", date: "2026-10-18", idempotencyKey: "recovery-1" })!
    assert.equal(resolveBankSettlementLifecycleEffect(f.rows, { ...scope, request })?.status, "reversed")
    assert.equal(resolveBankSettlementLifecycleEffect(f.rows, { ...scope, request: { ...request, idempotencyKey: "other" } }), null)
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, payments: [...f.rows.payments, ...f.rows.payments] }, scope), null)
    assert.equal(resolveBankSettlementLifecycleEffect(f.rows, { ...scope, companyId: "9" }), null)
    assert.equal(resolveBankSettlementLifecycleEffect({ ...f.rows, lines: [{ ...f.rows.lines[0], metadata: undefined }] }, scope), null)
  })
  it("confirms funds-only compensation without restoring a changed intended invoice selection", () => {
    const f = reversedFixture()
    const attempt = { ...f.attempt, allocationApplied: false }
    const rows = { ...f.rows, lines: [{ ...f.rows.lines[0], metadata: { bankSettlement: attempt } }],
      moves: f.rows.moves.filter((row) => !["70", "71"].includes(String(row.id))),
      moveLines: f.rows.moveLines.filter((row) => !["91", "93"].includes(String(row.id))),
    }
    assert.equal(resolveBankSettlementLifecycleEffect(rows, scope)?.status, "reversed")
    assert.equal(resolveBankSettlementLifecycleEffect({ ...rows, lines: [{ ...rows.lines[0], metadata: { bankSettlement: { ...attempt, allocationApplied: true } } }] }, scope), null)
  })
  it("proves supplier payment compensation using signed payable residuals", () => {
    const f = reversedFixture()
    const attempt = { ...f.attempt, selectedResiduals: f.attempt.selectedResiduals.map((row) => ({ ...row, residual: -row.residual })) }
    const rows = { ...f.rows,
      lines: [{ ...f.rows.lines[0], amount: -100, amountResidual: -100, metadata: { bankSettlement: attempt } }],
      payments: f.rows.payments.map((row) => ({ ...row, paymentType: "Outbound", partnerType: "Supplier" })),
      moves: f.rows.moves.map((row) => ["70", "71"].includes(String(row.id)) ? { ...row, moveType: "InInvoice" } : row),
      moveLines: f.rows.moveLines.map((row) => ({ ...row, accountInternalType: row.accountInternalType === "receivable" ? "payable" : row.accountInternalType,
        debit: row.credit, credit: row.debit, ...(row.balance != null ? { balance: -Number(row.balance) } : {}), amountResidual: -Number(row.amountResidual) })),
    }
    assert.equal(resolveBankSettlementLifecycleEffect(rows, scope)?.status, "reversed")
  })
})

describe("bank settlement recovery command transport", () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" })))
  afterEach(() => { globalThis.fetch = originalFetch; registerLumiereApiClient(null) })
  const reviewedRequest = () => {
    const f = reversedFixture()
    return bankSettlementRecoveryRequest({ ...scope, statementId: "31" }, bankSettlementAttempt({ bankSettlement: { ...f.attempt, status: "settled" } })!,
      { action: "reverse", reason: "Wrong bank receipt", date: "2026-10-18", idempotencyKey: "recovery-1" })!
  }
  const intercept = (rows: BankSettlementCanonicalRows, firstStatus = 200, acknowledge = true) => {
    const calls: { url: string; body: string | undefined; method: string }[] = []
    let posts = 0
    const collections: Record<string, readonly Record<string, unknown>[]> = { "bank-statement-lines": rows.lines, "bank-statements": rows.statements,
      "account-payments": rows.payments, "account-moves": rows.moves, "account-move-lines": rows.moveLines }
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? "GET"
      calls.push({ url, method, body: init?.body == null ? undefined : String(init.body) })
      if (method === "POST") {
        posts += 1
        const status = posts === 1 ? firstStatus : 200
        return new Response(JSON.stringify(status === 200
          ? acknowledge ? { ok: true, operationId: "erp.reverse_bank_statement_settlement", correlationId: "synthetic-bank-recovery" } : {}
          : { error: "Synthetic response lost", correlationId: "synthetic-bank-recovery" }), { status, headers: { "Content-Type": "application/json" } })
      }
      const resource = new URL(url).pathname.split("/").at(-1)!
      return new Response(JSON.stringify({ data: collections[resource] ?? [] }), { status: 200, headers: { "Content-Type": "application/json" } })
    }) as typeof fetch
    return calls
  }
  it("reuses the original typed key/date/payload after a lost response and proves the financial effect", async () => {
    const request = reviewedRequest(), calls = intercept(reversedFixture().rows, 504)
    await assert.rejects(recoverBankStatementSettlement(request, () => true), (error: unknown) => error instanceof Error && "status" in error && error.status === 504)
    const effect = await recoverBankStatementSettlement(request, () => true)
    assert.equal(effect.status, "reversed")
    const posts = calls.filter((call) => call.method === "POST")
    assert.equal(posts.length, 2)
    assert.equal(posts[0]!.body, posts[1]!.body)
    assert.equal(posts[0]!.url, `http://api.test${stdbBffCallUrl("reverse_bank_statement_settlement")}`)
    assert.deepEqual(JSON.parse(posts[0]!.body!), { companyId: 8, lineId: 41, params: { payment_id: 50, idempotency_key: "recovery-1", reason: "Wrong bank receipt", date: { __timestamp_micros_since_unix_epoch__: 1792281600000000 } } })
    const reads = calls.filter((call) => call.method === "GET")
    assert.equal(reads.length, 5)
    assert.equal(reads.every((call) => new URL(call.url).searchParams.get("companyId") === "8"), true)
  })
  it("does not report success when the bank clears but the compensating journal cannot be read", async () => {
    const malformedCalls = intercept(reversedFixture().rows, 200, false)
    await assert.rejects(recoverBankStatementSettlement(reviewedRequest(), () => true), /expected acknowledgement/)
    assert.equal(malformedCalls.length, 1)
    const f = reversedFixture(), calls = intercept({ ...f.rows, moves: f.rows.moves.filter((row) => row.id !== "80") })
    await assert.rejects(recoverBankStatementSettlement(reviewedRequest(), () => true), /did not read back exactly/)
    assert.equal(calls.filter((call) => call.method === "POST").length, 1)
  })
  it("fences company/actor loss and unsupported identifiers before dispatch", async () => {
    const calls = intercept(reversedFixture().rows), request = reviewedRequest()
    await assert.rejects(recoverBankStatementSettlement(request, () => false), /original user and company/)
    let fenceCalls = 0
    await assert.rejects(recoverBankStatementSettlement(request, () => ++fenceCalls < 2), /review is no longer active/)
    await assert.rejects(recoverBankStatementSettlement({ ...request, paymentId: "9007199254740993" }, () => true), /identifier is not supported/)
    assert.equal(calls.length, 0)
  })
})
