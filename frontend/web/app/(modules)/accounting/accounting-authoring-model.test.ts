import assert from "node:assert/strict"
import test from "node:test"
import { instalmentAmountExample, instalmentDateExample, proposedLedgerTotals, taxAmountExample } from "./accounting-authoring-model"

test("tax examples distinguish included and excluded percentages", () => {
  assert.deepEqual(taxAmountExample({ amount: 20, amountType: "percent", priceInclude: false }, 100), { base: 100, tax: 20, total: 120 })
  assert.deepEqual(taxAmountExample({ amount: 20, amountType: "percent", priceInclude: true }, 120), { base: 100, tax: 20, total: 120 })
})

test("tax examples with unsupported modes or invalid numbers never invent a result", () => {
  for (const amountType of ["fixed", "division", "python_code"]) {
    assert.equal(taxAmountExample({ amount: 20, amountType }, 100), null)
  }
  for (const amount of ["", undefined, -1, 101, Infinity, "invalid"]) {
    assert.equal(taxAmountExample({ amount, amountType: "percent" }, 100), null)
  }
  assert.equal(taxAmountExample({ amount: 20, amountType: "percent" }, NaN), null)
})

const moves = [{ id: 1n, companyId: 10n, state: { tag: "Draft" } }, { id: 2n, companyId: 11n, state: "Draft" }]
const lines = [{ moveId: 1n, companyId: 10n, debit: 50, credit: 0 }, { moveId: 2n, companyId: 11n, debit: 999, credit: 0 }]

test("ledger preview adds the proposed line to the exact current-company draft", () => {
  assert.deepEqual(proposedLedgerTotals({ moveId: "1", debit: 0, credit: 50 }, "10", moves, lines), { debit: 50, credit: 50, difference: 0, lineCount: 1 })
})

test("ledger preview rejects a foreign, duplicate, posted or missing draft", () => {
  const values = { moveId: "1", debit: 0, credit: 50 }
  assert.equal(proposedLedgerTotals(values, "11", moves, lines), null)
  assert.equal(proposedLedgerTotals(values, "10", [...moves, moves[0]], lines), null)
  assert.equal(proposedLedgerTotals(values, "10", [{ ...moves[0], state: "Posted" }], lines), null)
  assert.equal(proposedLedgerTotals({ ...values, moveId: "9" }, "10", moves, lines), null)
})

test("ledger preview rejects unscoped rows and invalid amounts", () => {
  const values = { moveId: "1", debit: 0, credit: 50 }
  assert.equal(proposedLedgerTotals(values, "10", moves, [{ moveId: 1n, debit: 50, credit: 0 }]), null)
  assert.equal(proposedLedgerTotals(values, "10", moves, [{ ...lines[0], debit: NaN }]), null)
  assert.equal(proposedLedgerTotals({ ...values, credit: Infinity }, "10", moves, lines), null)
  assert.equal(proposedLedgerTotals({ ...values, credit: "" }, "10", moves, lines), null)
})

test("simple instalment examples add days in UTC across a month boundary", () => {
  assert.equal(instalmentDateExample("2026-01-31", { days: 30, months: 0 }), "2026-03-02")
  assert.equal(instalmentDateExample("2028-02-28", { days: 1 }), "2028-02-29")
})

test("instalment examples leave complex calendars and invalid dates to the full schedule", () => {
  assert.equal(instalmentDateExample("2026-01-31", { days: 0, months: 1 }), null)
  assert.equal(instalmentDateExample("2026-01-31", { days: 30, daysAfterEndOfMonth: true }), null)
  assert.equal(instalmentDateExample("2026-02-30", { days: 1 }), null)
  assert.equal(instalmentDateExample("", { days: 30 }), null)
  assert.equal(instalmentDateExample("2026-01-31", { days: -1 }), null)
})

test("instalment sample amounts never mistake a balance line for the complete invoice", () => {
  assert.equal(instalmentAmountExample(1000, { value: "Percent", valueAmount: 30 }), 300)
  assert.equal(instalmentAmountExample(1000, { value: "Fixed", valueAmount: 250 }), 250)
  assert.equal(instalmentAmountExample(1000, { value: "Balance", valueAmount: 0 }), null)
  assert.equal(instalmentAmountExample(1000, { value: "Percent", valueAmount: 101 }), null)
  assert.equal(instalmentAmountExample(NaN, { value: "Fixed", valueAmount: 250 }), null)
})
