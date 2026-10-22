import assert from "node:assert/strict"
import test from "node:test"
import { File } from "node:buffer"
import type { AllocatePaymentParams } from "@lumiere/stdb/types"
import { allocationReadback, allocationSource, paymentId, paymentInputAmount, prepareStatementImport, statementBalanceReview, statementImportReadback, statementReviewMatches, type ImportProjection, type PaymentLookupRow } from "./payment-workflow-model"

const scope = { organizationId: 1n, companyId: 2n }
const txn: PaymentLookupRow = { id: 3n, ...scope, status: "Posted", currencyId: 4n, partnerId: 5n, partnerType: "Customer", paymentAccountId: 6n, settlementAmount: 100 }
const paymentAccount = { id: 6n, ...scope, currencyId: 4n, archivedAt: null }
const move = { id: 7n, ...scope, state: "Posted", moveType: "OutInvoice", journalId: 8n, partnerId: 5n, currencyId: 4n, name: "INV/007" }
const account = { id: 9n, ...scope, internalType: { some: { tag: "Receivable" } }, deprecated: false }
const line: PaymentLookupRow = { id: 10n, ...scope, moveId: 7n, accountId: 9n, journalId: 8n, partnerId: 5n, currencyId: 4n, amountResidual: 70 }
const writeOffAccount = { id: 11n, ...scope, internalGroup: { some: "Expense" }, deprecated: false }
const input = { ...scope, transactionId: 3n, ready: true, transactions: [txn], paymentAccounts: [paymentAccount], reconciliations: [] as PaymentLookupRow[], lines: [line], moves: [move], glAccounts: [account, writeOffAccount] }
const params: AllocatePaymentParams = { idempotencyKey: "allocation-key", companyId: 2n, paymentTransactionId: 3n, allocatedMoveLineId: 10n, allocatedAmount: 50, currencyId: 4n, writeOffAmount: 5, writeOffAccountId: 11n, metadata: undefined }
const saved: PaymentLookupRow = { id: 12n, ...scope, currencyId: 4n, paymentTransactionId: 3n, allocatedMoveLineId: 10n, allocatedAmount: 50, writeOffAmount: 5, writeOffAccountId: 11n, residualBefore: 70, residualAfter: 15, isReversal: false, reversedReconciliationId: null }
function ready(source: ReturnType<typeof allocationSource>) {
  assert.equal(source.kind, "ready")
  if (source.kind !== "ready") throw new Error("Expected ready source")
  return source
}

test("joins exact posted invoice identities and optional account roles", () => {
  const source = ready(allocationSource(input))
  assert.equal(source.available, 100)
  assert.deepEqual(source.items.map((item) => [item.line.id, item.move.id, item.residual]), [[10n, 7n, 70]])
  assert.deepEqual(source.writeOffAccounts.map((row) => row.id), [11n])
})

test("fails closed for unavailable reads, absent amounts, and unreadable archive state", () => {
  assert.equal(allocationSource({ ...input, ready: false }).kind, "unavailable")
  assert.equal(allocationSource({ ...input, transactions: [{ ...txn, settlementAmount: undefined }] }).kind, "unavailable")
  assert.equal(allocationSource({ ...input, transactions: [{ ...txn, currencyId: undefined }] }).kind, "unavailable")
  const { archivedAt: _archived, ...unreadableArchive } = paymentAccount
  assert.equal(allocationSource({ ...input, paymentAccounts: [unreadableArchive] }).kind, "unavailable")
  assert.equal(ready(allocationSource({ ...input, lines: [{ ...line, amountResidual: undefined }] })).items.length, 0)
})

test("excludes foreign, stale, mismatched, and duplicate target identities", () => {
  for (const changed of [{ companyId: 99n }, { organizationId: 99n }, { partnerId: 99n }, { currencyId: 99n }, { journalId: 99n }, { accountId: 99n }, { amountResidual: 0 }]) assert.equal(ready(allocationSource({ ...input, lines: [{ ...line, ...changed }] })).items.length, 0)
  for (const changed of [{ state: "Draft" }, { moveType: "Entry" }, { companyId: 99n }, { partnerId: 99n }]) assert.equal(ready(allocationSource({ ...input, moves: [{ ...move, ...changed }] })).items.length, 0)
  assert.equal(ready(allocationSource({ ...input, lines: [line, line] })).items.length, 0)
  assert.equal(ready(allocationSource({ ...input, glAccounts: [{ ...account, deprecated: undefined }] })).items.length, 0)
  assert.equal(ready(allocationSource({ ...input, glAccounts: [{ ...account, internalType: "Payable" }] })).items.length, 0)
})

test("supplier allocations use payable items and income write-off accounts", () => {
  const source = ready(allocationSource({ ...input, transactions: [{ ...txn, partnerType: "Supplier" }], glAccounts: [{ ...account, internalType: "Payable" }, { ...writeOffAccount, internalGroup: "Income" }] }))
  assert.equal(source.items.length, 1)
  assert.equal(source.writeOffAccounts.length, 1)
})

test("uses signed owner history and excludes active transaction-line relations", () => {
  const existing = { ...saved, allocatedAmount: 30, writeOffAmount: 0 }
  assert.equal(ready(allocationSource({ ...input, reconciliations: [existing] })).available, 70)
  assert.equal(ready(allocationSource({ ...input, reconciliations: [existing] })).items.length, 0)
  const reversed = { ...existing, id: 13n, isReversal: true, reversedReconciliationId: 12n, allocatedAmount: -30 }
  const source = ready(allocationSource({ ...input, reconciliations: [existing, reversed] }))
  assert.equal(source.available, 100)
  assert.equal(source.items.length, 1)
  assert.equal(allocationSource({ ...input, reconciliations: [existing, existing] }).kind, "unavailable")
  assert.equal(allocationSource({ ...input, reconciliations: [{ ...existing, companyId: 99n }] }).kind, "unavailable")
  assert.equal(allocationSource({ ...input, reconciliations: [{ ...existing, allocatedAmount: undefined }] }).kind, "unavailable")
})

test("allocation confirmation requires exact relation and full economic fields", () => {
  assert.deepEqual(allocationReadback(params, [saved], 1n), { kind: "confirmed", id: 12n })
  for (const changed of [{ companyId: 99n }, { organizationId: 99n }, { currencyId: 99n }, { allocatedAmount: 51 }, { writeOffAmount: 0 }, { writeOffAccountId: 99n }, { residualAfter: 10 }, { residualBefore: undefined }]) assert.equal(allocationReadback(params, [{ ...saved, ...changed }], 1n).kind, "conflict")
  assert.equal(allocationReadback(params, [{ ...saved, allocatedMoveLineId: 99n }], 1n).kind, "pending")
  assert.equal(allocationReadback(params, [saved, { ...saved, id: 13n }], 1n).kind, "ambiguous")
  assert.equal(allocationReadback(params, [saved, { ...saved, id: 13n, isReversal: true, reversedReconciliationId: 12n }], 1n).kind, "pending")
  assert.equal(allocationReadback(params, [saved, { ...saved, id: 13n, isReversal: true, reversedReconciliationId: undefined }], 1n).kind, "conflict")
  const { writeOffAccountId: _account, ...unreadableAccount } = saved
  assert.equal(allocationReadback({ ...params, writeOffAccountId: undefined, writeOffAmount: 0 }, [{ ...unreadableAccount, writeOffAmount: 0, residualAfter: 20 }], 1n).kind, "conflict")
})

test("preserves large exact IDs and rejects coerced absent or non-finite money", () => {
  assert.equal(paymentId("9007199254740993"), 9007199254740993n)
  assert.equal(paymentId(9007199254740993), null)
  assert.equal(paymentId("1,000"), null)
  for (const value of ["", " ", undefined, null, true, {}, Infinity, "Infinity"]) assert.equal(paymentInputAmount(value), null)
  assert.equal(paymentInputAmount("0"), 0)
  assert.equal(paymentInputAmount("12.50"), 12.5)
})

const csv = "date,amount,reference,description\n2026-10-01,25,TX-1,Transfer\n2026-10-02,0,TX-2,Zero\ninvalid,10,TX-3,Invalid date"
function importValues() { return { csvFile: [new File([csv], "statement.csv", { type: "text/csv" })], journalId: "8", currencyId: "4", openingBalance: "100", fileName: "" } }

test("local CSV review uses canonical parser/key and excludes invalid rows from balance estimate", async () => {
  const values = importValues()
  const review = await prepareStatementImport(values, 2n)
  assert.equal(review.params.rows.length, 3)
  assert.equal(review.params.rows[0].reference, "TX-1")
  assert.equal(review.params.fileName, "statement.csv")
  assert.deepEqual(statementBalanceReview(review), { validRows: 1, invalidRows: 2, movement: 25, closing: 125, withinEnvelope: true })
  assert.equal(statementReviewMatches(review, values, 2n), true)
  for (const changed of [{ journalId: "9" }, { currencyId: "9" }, { openingBalance: 200 }, { fileName: "renamed.csv" }, { csvFile: importValues().csvFile }]) assert.equal(statementReviewMatches(review, { ...values, ...changed }, 2n), false)
  assert.equal(statementReviewMatches(review, values, 99n), false)
  const changedSetup = await prepareStatementImport({ ...values, openingBalance: 200 }, 2n)
  assert.equal(changedSetup.params.idempotencyKey, review.params.idempotencyKey, "Opening balance is excluded from the existing file key; full readback must check it")
})

test("local CSV review rejects absent setup and detects out-of-range aggregate", async () => {
  await assert.rejects(() => prepareStatementImport({ ...importValues(), journalId: "" }, 2n))
  const review = await prepareStatementImport({ ...importValues(), openingBalance: 1_000_000_000 }, 2n)
  assert.equal(statementBalanceReview(review).withinEnvelope, false)
})

async function savedImportFixture() {
  const review = await prepareStatementImport(importValues(), 2n)
  const header: ImportProjection = { id: 20n, companyId: 2n, journalId: 8n, currencyId: 4n, fileName: review.params.fileName, idempotencyKey: review.params.idempotencyKey, openingBalance: 100, totalRows: 3 }
  const lines: ImportProjection[] = review.params.rows.map((row, index) => ({ id: BigInt(21 + index), importId: 20n, rowNumber: row.rowNumber, date: row.date ?? null, amount: row.amount ?? null, reference: row.reference ?? null, description: row.description ?? null }))
  return { review, header, lines }
}

test("import readback requires full setup and all parsed rows, not the file key alone", async () => {
  const { review, header, lines } = await savedImportFixture()
  assert.deepEqual(statementImportReadback(review, [header], lines), { kind: "confirmed", id: 20n })
  for (const changed of [{ journalId: 99n }, { currencyId: 99n }, { fileName: "changed.csv" }, { openingBalance: 200 }, { totalRows: 2 }]) assert.equal(statementImportReadback(review, [{ ...header, ...changed }], lines).kind, "conflict")
  assert.equal(statementImportReadback(review, [{ ...header, companyId: 99n }], lines).kind, "pending")
  for (const changed of [{ amount: 26 }, { description: "Changed" }, { reference: "Changed" }, { date: { invalid: true } }]) assert.equal(statementImportReadback(review, [header], [{ ...lines[0], ...changed }, ...lines.slice(1)]).kind, "conflict")
  assert.equal(statementImportReadback(review, [header], lines.slice(1)).kind, "conflict")
  assert.equal(statementImportReadback(review, [header, { ...header, id: 99n }], lines).kind, "ambiguous")
  assert.equal(statementImportReadback(review, [header], [lines[0], { ...lines[0], id: 99n }, lines[2]]).kind, "ambiguous")
})
