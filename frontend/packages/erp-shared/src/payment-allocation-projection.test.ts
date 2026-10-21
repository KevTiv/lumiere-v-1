import assert from "node:assert/strict"
import test from "node:test"
import {
  paymentMinorUnitsText,
  paymentMoneyMinor,
  projectPaymentAllocations,
  type PaymentAllocationCollection,
  type PaymentAllocationRow,
  type PaymentAllocationSources,
} from "./payment-allocation-projection"

const read = (rows: PaymentAllocationRow[] = []): PaymentAllocationCollection => ({ rows, state: { status: "ready" } })
const scoped = (id: number, extra: PaymentAllocationRow = {}): PaymentAllocationRow => ({ id, organizationId: 42, companyId: 7, ...extra })
const payment = (id = 1, extra: PaymentAllocationRow = {}) => scoped(id, {
  state: "Paid", paymentType: "InBound", moveId: id + 100, partnerId: 10, currencyId: 1, amount: 100, ...extra,
})
const move = (id = 101, extra: PaymentAllocationRow = {}) => scoped(id, { state: "Posted", currencyId: 1, ...extra })
const line = (id = 201, extra: PaymentAllocationRow = {}) => scoped(id, {
  moveId: 101, paymentId: 1, partnerId: 10, parentState: "Posted", accountInternalType: "receivable",
  currencyId: 1, companyCurrencyId: 1, balance: -100, amountResidual: 100, ...extra,
})
const transaction = (id = 301, extra: PaymentAllocationRow = {}) => scoped(id, {
  accountPaymentId: 1, status: "Posted", direction: "Inbound", currencyId: 1, partnerId: 10, settlementAmount: 100, ...extra,
})
function sources(extra: Partial<PaymentAllocationSources> = {}): PaymentAllocationSources {
  return {
    organizationId: 42, companyId: 7n, payments: read([payment()]), moves: read([move()]), moveLines: read([line()]),
    transactions: read(), reversals: read(), currencies: read([{ id: 1, decimalPlaces: 2 }, { id: 2, decimalPlaces: 0 }]), ...extra,
  }
}

test("legacy payment clearing residual reflects partial and multi-invoice allocations without relying on links", () => {
  const initial = projectPaymentAllocations(sources())
  assert.equal(initial.state.status, "ready")
  assert.equal(initial.rows[0]?.remainingMinor, 10000n)
  const partial = projectPaymentAllocations(sources({ moveLines: read([line(201, { amountResidual: -60 })]) }))
  assert.equal(partial.rows[0]?.allocatedMinor, 4000n)
  assert.equal(partial.rows[0]?.remainingMinor, 6000n)
  // A split clearing move may service several invoices. The current residuals
  // already include their allocations, so no historical amount is added again.
  const multiple = projectPaymentAllocations(sources({ moveLines: read([
    line(201, { balance: -60, amountResidual: 0 }), line(202, { balance: -40, amountResidual: 25 }),
  ]) }))
  assert.equal(multiple.state.status, "ready")
  assert.equal(multiple.rows[0]?.allocatedMinor, 7500n)
  assert.equal(multiple.rows[0]?.remainingMinor, 2500n)
  assert.equal(projectPaymentAllocations(sources({ moveLines: read([line(201, { amountResidual: 0 })]) })).rows[0]?.remainingMinor, 0n)
})

test("operational allocation and document write-off use the canonical payment residual once", () => {
  const result = projectPaymentAllocations(sources({
    transactions: read([transaction()]), moveLines: read([line(201, { amountResidual: 20 })]),
  }))
  assert.equal(result.state.status, "ready")
  assert.equal(result.rows[0]?.transactionId, "301")
  assert.equal(result.rows[0]?.allocatedMinor, 8000n)
  assert.equal(result.rows[0]?.remainingMinor, 2000n)
  // A document write-off reduces its invoice residual but does not consume any
  // additional payment funds, so document residuals are never subtracted here.
  const withWrittenOffDocument = projectPaymentAllocations(sources({
    moves: read([move(), move(999, { amountResidual: 0 })]),
    transactions: read([transaction()]), moveLines: read([line(201, { amountResidual: 20 })]),
  }))
  assert.equal(withWrittenOffDocument.rows[0]?.remainingMinor, 2000n)
})

test("subscription clearing links keep unrelated operational allocations available", () => {
  const subscriptionLine = line(202, { moveId: 102, paymentId: undefined, amountResidual: 0 })
  const mixed = sources({
    payments: read([payment(), payment(2)]), moves: read([move(), move(102)]),
    transactions: read([transaction()]), moveLines: read([line(), subscriptionLine]),
  })
  // A fully settled subscription payment still needs its canonical reverse
  // link. Its zero residual must not hide an incomplete ledger record.
  const incomplete = projectPaymentAllocations(mixed)
  assert.equal(incomplete.state.status, "partial")
  assert.deepEqual(incomplete.rows, [])
  const linked = projectPaymentAllocations({ ...mixed,
    moveLines: read([line(), { ...subscriptionLine, paymentId: 2 }]),
  })
  assert.equal(linked.state.status, "ready")
  assert.equal(linked.rows.find((row) => row.transactionId === "301")?.remainingMinor, 10000n)
  assert.equal(linked.rows.find((row) => row.paymentId === "2")?.remainingMinor, 0n)
})

test("a last cent left by earlier partial payments remains available and disappears only after final settlement", () => {
  const almostSettled = projectPaymentAllocations(sources({ moveLines: read([line(201, { amountResidual: 100 - 99.99 })]) }))
  assert.equal(almostSettled.state.status, "ready")
  assert.equal(almostSettled.rows[0]?.remainingMinor, 1n)
  assert.equal(almostSettled.rows[0]?.allocatedMinor, 9999n)
  const settled = projectPaymentAllocations(sources({ moveLines: read([line(201, { amountResidual: 0 })]) }))
  assert.equal(settled.rows[0]?.remainingMinor, 0n)
  assert.equal(settled.rows[0]?.allocatedMinor, 10000n)
})

test("posted supplier payments use payable clearing residuals with either persisted sign", () => {
  const result = projectPaymentAllocations(sources({
    payments: read([payment(1, { paymentType: { tag: "OutBound" } })]),
    moveLines: read([line(201, { accountInternalType: { some: "Payable" }, balance: 100, amountResidual: -30 })]),
  }))
  assert.equal(result.state.status, "ready")
  assert.equal(result.rows[0]?.remainingMinor, 3000n)
})

test("drafts awaiting approval, voided transactions and cancelled legacy payments are not allocatable", () => {
  const result = projectPaymentAllocations(sources({
    payments: read([payment(1, { state: { notPaid: [] }, moveId: undefined }), payment(2, { state: "Reversed" })]),
    transactions: read([transaction(301, { status: "Draft", accountPaymentId: undefined }), transaction(302, { status: "Voided", accountPaymentId: undefined })]),
    moves: read(), moveLines: read(),
  }))
  assert.deepEqual(result, { rows: [], state: { status: "ready" } })
})

function reversedSources(): PaymentAllocationSources {
  return sources({
    payments: read([payment(), payment(2, { paymentType: "OutBound" })]),
    transactions: read([
      transaction(301, { status: "Reversed" }),
      transaction(302, { accountPaymentId: 2, direction: "Outbound", sourceEntity: { some: "reversal" }, sourceEntityId: { some: 301 } }),
    ]),
    reversals: read([scoped(401, { originalTransactionId: 301, correctingTransactionId: 302, originalAccountPaymentId: 1, correctingAccountPaymentId: 2 })]),
  })
}

test("reversed originals and their posted correction payments do not become available cash", () => {
  assert.deepEqual(projectPaymentAllocations(reversedSources()), { rows: [], state: { status: "ready" } })
  const incomplete = reversedSources()
  incomplete.reversals = read()
  assert.equal(projectPaymentAllocations(incomplete).state.status, "partial")
  const missingCorrection = reversedSources()
  missingCorrection.transactions = read([transaction(301, { status: "Reversed" })])
  assert.equal(projectPaymentAllocations(missingCorrection).state.status, "partial")
  const duplicateReversal = reversedSources()
  duplicateReversal.reversals = read([...duplicateReversal.reversals.rows, { ...duplicateReversal.reversals.rows[0], id: 402 }])
  assert.equal(projectPaymentAllocations(duplicateReversal).state.status, "partial")
})

test("company and organization scope never leak, and each currency retains its own precision", () => {
  const result = projectPaymentAllocations(sources({
    payments: read([payment(), payment(2, { currencyId: 2, amount: 1500 }), payment(3, { companyId: 8 }), payment(4, { organizationId: 43 })]),
    moves: read([move(), move(102, { currencyId: 2 }), move(103, { companyId: 8 }), move(104, { organizationId: 43 })]),
    moveLines: read([line(), line(202, { moveId: 102, paymentId: 2, currencyId: 2, companyCurrencyId: 2, balance: -1500, amountResidual: 300 }), line(203, { companyId: 8 }), line(204, { organizationId: 43 })]),
  }))
  assert.equal(result.state.status, "ready")
  assert.deepEqual(result.rows.map((row) => [row.paymentId, row.currencyId, row.remainingMinor]), [["1", "1", 10000n], ["2", "2", 300n]])
  const unrelatedPrecision = projectPaymentAllocations(sources({ currencies: read([{ id: 1, decimalPlaces: 2 }, { id: 99, decimalPlaces: 8 }]) }))
  assert.equal(unrelatedPrecision.state.status, "ready")
})

test("every unavailable source discards cached balances, preserving denied, error, loading and partial states", () => {
  for (const source of ["payments", "moves", "moveLines", "transactions", "reversals", "currencies"] as const) {
    for (const status of ["denied", "error", "loading", "partial"] as const) {
      const input = sources()
      input[source] = { ...input[source], state: { status } }
      const result = projectPaymentAllocations(input)
      assert.equal(result.state.status, status, `${source}: ${status}`)
      assert.deepEqual(result.rows, [])
    }
  }
})

test("duplicates, incomplete rows and cross-currency or cross-partner references fail visibly", () => {
  const invalid: Partial<PaymentAllocationSources>[] = [
    { payments: read([payment(), payment()]) },
    { payments: read([payment(), payment(2, { moveId: 101 })]) },
    { payments: read([payment(1, { organizationId: undefined })]) },
    { moves: read() },
    { moves: read([move(101, { state: "Draft" })]) },
    { moveLines: read() },
    { moveLines: read([line(), line()]) },
    { moveLines: read([line(201, { amountResidual: undefined })]) },
    { moveLines: read([line(201, { balance: -100, amountResidual: 101 })]) },
    { moveLines: read([line(201, { balance: -90 })]) },
    { moveLines: read([line(201, { currencyId: 2 })]) },
    { moveLines: read([line(201, { companyCurrencyId: 2 })]) },
    { moveLines: read([line(201, { partnerId: 11 })]) },
    { moveLines: read([line(201, { paymentId: 2 })]) },
    { moveLines: read([line(201, { accountInternalType: undefined })]) },
    { transactions: read([transaction(), transaction(302)]) },
    { transactions: read([transaction(301, { currencyId: 2 })]) },
    { transactions: read([transaction(301, { settlementAmount: 99 })]) },
    { currencies: read([{ id: 1 }]) },
  ]
  for (const extra of invalid) {
    const result = projectPaymentAllocations(sources(extra))
    assert.equal(result.state.status, "partial", JSON.stringify(extra))
    assert.deepEqual(result.rows, [])
  }
})

test("a valid new operational payment cannot mask an incomplete posted seed ledger", () => {
  const valid = { transactions: read([transaction()]) }
  // Legacy demo rows used these combinations. Fix the fixture ledger instead
  // of ignoring unrelated posted rows or presenting missing balances as zero.
  for (const extra of [
    { ...valid, payments: read([payment(), payment(2, { moveId: undefined, amount: 3600 })]) },
    { transactions: read([transaction(), transaction(302, { accountPaymentId: undefined })]) },
  ]) {
    const result = projectPaymentAllocations(sources(extra))
    assert.equal(result.state.status, "partial")
    assert.deepEqual(result.rows, [])
  }
})

test("missing roles on non-clearing liquidity lines do not suppress valid clearing balances", () => {
  const result = projectPaymentAllocations(sources({ moveLines: read([
    line(), line(202, { accountInternalType: undefined, balance: 100, amountResidual: 0 }),
  ]) }))
  assert.equal(result.state.status, "ready")
  assert.equal(result.rows[0]?.remainingMinor, 10000n)
})

test("minor-unit parsing rejects unsafe amounts and excess precision while handling floating representation noise", () => {
  assert.equal(paymentMoneyMinor(0.1 + 0.2, 2), 30n)
  assert.equal(paymentMoneyMinor(100 - 99.99, 2), 1n)
  assert.equal(paymentMoneyMinor("0.30", 2), 30n)
  assert.equal(paymentMoneyMinor("1500", 0), 1500n)
  assert.equal(paymentMoneyMinor(1.001, 2), null)
  assert.equal(paymentMoneyMinor(1.5, 0), null)
  assert.equal(paymentMoneyMinor(NaN, 2), null)
  assert.equal(paymentMoneyMinor(Infinity, 2), null)
  assert.equal(paymentMoneyMinor(true, 2), null)
  assert.equal(paymentMoneyMinor(Number.MAX_SAFE_INTEGER, 2), null)
  assert.equal(paymentMoneyMinor("90071992547409.92", 2), null)
  assert.equal(paymentMinorUnitsText(9007199254740991n, 2, "en-US"), "90,071,992,547,409.91")
})
