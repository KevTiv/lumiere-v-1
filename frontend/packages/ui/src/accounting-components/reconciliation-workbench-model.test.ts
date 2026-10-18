import { describe, expect, it } from "vitest"
import { projectReconciliation, reconciliationId, reconciliationSelection, type ReconciliationSource } from "./reconciliation-workbench-model"

export function reconciliationFixture(): ReconciliationSource {
  const line = { id: 10n, organizationId: 1n, statementId: 2n, journalId: 3n, amount: 1000, currencyId: null, journalCurrencyId: 7n, foreignCurrencyId: null, isReconciled: false, moveIds: [], transactionType: "Customer transfer" }
  return {
    organizationId: 1n, companyId: 4n, companyCurrencyId: 7n, state: { status: "ready" },
    statement: { id: 2n, organizationId: 1n, companyId: 4n, journalId: 3n, currencyId: 7n, state: { tag: "Open" }, name: "January bank statement" }, line, bankLines: [line],
    moves: [{ id: 20n, organizationId: 1n, companyId: 4n, name: "INV/2026/001", state: { tag: "Posted" }, moveType: "OutInvoice", partnerId: 50n, invoicePartnerDisplayName: "Alpha customer" }, { id: 21n, organizationId: 1n, companyId: 4n, name: "INV/2026/002", state: { tag: "Posted" }, moveType: "OutInvoice", partnerId: 50n, invoicePartnerDisplayName: "Beta customer" }],
    accounts: [{ id: 30n, organizationId: 1n, companyId: 4n, code: "1100", name: "Receivable", reconcile: true, deprecated: false, internalType: "Receivable" }],
    moveLines: [{ id: 40n, organizationId: 1n, companyId: 4n, moveId: 20n, accountId: 30n, companyCurrencyId: 7n, currencyId: 7n, parentState: { tag: "Posted" }, name: "Consulting services", debit: 800, credit: 0, balance: 800, amountResidual: 600, blocked: false, partnerId: 50n }, { id: 41n, organizationId: 1n, companyId: 4n, moveId: 21n, accountId: 30n, companyCurrencyId: 7n, currencyId: 7n, parentState: { tag: "Posted" }, name: "Support services", debit: 400, credit: 0, balance: 400, amountResidual: 400, blocked: false, partnerId: 50n }],
    currencies: [{ id: 7n, code: "EUR", decimalPlaces: 2, roundingFactor: 0.01 }],
    suggestions: [{ entityId: 41n, organizationId: 1n, statementLineId: 10n }],
  }
}
describe("reconciliation review projection", () => {
  it("uses exact journal-item IDs, canonical open amounts and actual document labels", () => {
    const projection = projectReconciliation(reconciliationFixture())
    expect(projection.status).toBe("ready")
    if (projection.status !== "ready") return
    expect(projection.candidates.map((row) => row.id)).toEqual(["41", "40"])
    expect(projection.candidates.find((row) => row.id === "40")).toMatchObject({ moveId: "20", amount: 600, documentLabel: "INV/2026/001", href: "/accounting/invoices/20", accountLabel: "1100 · Receivable" })
    const review = reconciliationSelection(projection, ["40", "41"])
    expect(review.total).toBe(1000)
    expect(review.difference).toBe(0)
    expect(review.request).toEqual({ organizationId: "1", companyId: "4", statementId: "2", lineId: "10", moveLineIds: ["41", "40"], amountResidual: 0 })
    expect(reconciliationSelection(projection, ["40"]).request).toBeNull()
    expect(reconciliationSelection(projection, ["40", "41", "40"]).request).toBeNull()
    expect(reconciliationSelection(projection, ["40", "41", "missing"]).request).toBeNull()
  })
  it("fails closed for stale, unavailable or denied reads instead of displaying cached options", () => {
    for (const status of ["loading", "error", "denied", "partial"] as const) expect(projectReconciliation({ ...reconciliationFixture(), state: { status } })).toEqual({ status: "unavailable", state: { status } })
  })
  it("rejects foreign scope, non-open statements, stale focus rows, existing or missing bank links", () => {
    for (const statement of [{ companyId: 9n }, { organizationId: 9n }, { state: "Posted" }, { journalId: undefined }]) {
      const source = reconciliationFixture()
      source.statement = { ...source.statement!, ...statement }
      expect(projectReconciliation(source).status).toBe("blocked")
    }
    for (const patch of [{ isReconciled: true }, { isReconciled: undefined }, { moveIds: [40n] }, { moveIds: undefined }, { amount: null }, { amount: undefined }, { statementId: 99n }, { journalId: 99n }]) {
      const source = reconciliationFixture()
      source.bankLines = [{ ...source.line!, ...patch }]
      expect(projectReconciliation(source).status).toBe("blocked")
    }
    const source = reconciliationFixture()
    expect(projectReconciliation({ ...source, bankLines: [] }).status).toBe("blocked")
    expect(projectReconciliation({ ...source, bankLines: [source.line!, source.line!] }).status).toBe("blocked")
  })
  it("never compares a foreign amountCurrency or mixed company-currency balance", () => {
    for (const patch of [{ foreignCurrencyId: 8n, amountCurrency: 1000 }, { currencyId: 8n }, { journalCurrencyId: 8n }, { foreignCurrencyId: undefined }]) {
      const source = reconciliationFixture()
      source.bankLines = [{ ...source.line!, ...patch }]
      expect(projectReconciliation(source).status).toBe("blocked")
    }
    const source = reconciliationFixture()
    source.moveLines = source.moveLines.map((row) => ({ ...row, companyCurrencyId: 8n }))
    expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
  })
  it("ignores suggested draft, wrong-sign, redacted, blocked, duplicate and non-reconcilable items", () => {
    for (const patch of [{ companyId: 9n }, { organizationId: 9n }, { parentState: "Draft" }, { blocked: true }, { blocked: undefined }, { amountResidual: null }, { amountResidual: "" }, { amountResidual: -600 }, { amountResidual: 900 }, { balance: null }, { debit: null }, { credit: undefined }, { currencyId: 8n }, { companyCurrencyId: undefined }, { debit: 801 }]) {
      const source = reconciliationFixture()
      source.moveLines = [{ ...source.moveLines[0]!, ...patch }]
      expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
    }
    for (const patch of [{ reconcile: false }, { reconcile: undefined }, { deprecated: true }, { companyId: 9n }]) {
      const source = reconciliationFixture()
      source.accounts = [{ ...source.accounts[0]!, ...patch }]
      expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
    }
    const source = reconciliationFixture()
    source.moveLines = [source.moveLines[0]!, source.moveLines[0]!]
    expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
  })
  it("requires the posted actual parent and excludes records already linked to another bank line", () => {
    const source = reconciliationFixture()
    source.moves = source.moves.map((row) => ({ ...row, state: "Draft" }))
    expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
    const linked = reconciliationFixture()
    linked.bankLines = [...linked.bankLines, { id: 11n, organizationId: 1n, moveIds: [40n] }]
    const result = projectReconciliation(linked)
    expect(result.status === "ready" ? result.candidates.map((row) => row.id) : []).toEqual(["41"])
    expect(projectReconciliation({ ...linked, bankLines: [...linked.bankLines, { organizationId: 1n }] }).status).toBe("blocked")
  })
  it("supports signed payable credits without pretending a missing amount is zero", () => {
    const source = reconciliationFixture()
    source.bankLines = [{ ...source.line!, amount: -1000 }]
    source.moves = source.moves.map((row) => ({ ...row, moveType: "InInvoice" }))
    source.accounts = source.accounts.map((row) => ({ ...row, internalType: "Payable" }))
    source.moveLines = source.moveLines.map((row) => ({ ...row, debit: 0, credit: row.debit, balance: -Number(row.balance), amountResidual: -Number(row.amountResidual) }))
    const projection = projectReconciliation(source)
    expect(reconciliationSelection(projection, ["40", "41"])).toMatchObject({ total: -1000, difference: 0, request: { amountResidual: 0 } })
  })
  it("uses declared precision without accepting a one-cent writeoff, fractional minor unit or unknown precision", () => {
    const source = reconciliationFixture()
    source.bankLines = [{ ...source.line!, amount: 1000.01 }]
    expect(reconciliationSelection(projectReconciliation(source), ["40", "41"])).toMatchObject({ total: 1000, difference: 0.01, request: null })
    source.bankLines = [{ ...source.line!, amount: 1000.001 }]
    expect(projectReconciliation(source).status).toBe("blocked")
    for (const patch of [{ decimalPlaces: undefined }, { roundingFactor: undefined }, { roundingFactor: 0.05 }, { decimalPlaces: 8 }]) expect(projectReconciliation({ ...reconciliationFixture(), currencies: [{ id: 7n, decimalPlaces: 2, roundingFactor: 0.01, ...patch }] }).status).toBe("blocked")
    const zero = reconciliationFixture()
    zero.currencies = [{ id: 7n, code: "JPY", decimalPlaces: 0, roundingFactor: 1 }]
    expect(reconciliationSelection(projectReconciliation(zero), ["40", "41"]).request).not.toBeNull()
    const three = reconciliationFixture()
    three.currencies = [{ id: 7n, code: "KWD", decimalPlaces: 3, roundingFactor: 0.001 }]
    three.bankLines = [{ ...three.line!, amount: 1000.001 }]
    expect(reconciliationSelection(projectReconciliation(three), ["40", "41"])).toMatchObject({ difference: 0.001, request: null })
    three.moveLines = [three.moveLines[0]!, { ...three.moveLines[1]!, balance: 400.001, debit: 400.001, amountResidual: 400.001 }]
    expect(reconciliationSelection(projectReconciliation(three), ["40", "41"]).request).not.toBeNull()
  })
  it("preserves exact u64 IDs and rejects lossy or invalid identifiers", () => {
    expect(reconciliationId("18446744073709551615")).toBe("18446744073709551615")
    for (const id of [Number.MAX_SAFE_INTEGER + 1, "18446744073709551616", "01", "0", "-1", "1.5", null]) expect(reconciliationId(id)).toBeNull()
  })
})

describe("settlement selection boundaries", () => {
  it("requires one partner and every open line of each selected invoice", () => {
    const mixed = reconciliationFixture()
    mixed.moves = mixed.moves.map((row, index) => ({ ...row, partnerId: BigInt(50 + index) }))
    mixed.moveLines = mixed.moveLines.map((row, index) => ({ ...row, partnerId: BigInt(50 + index) }))
    expect(reconciliationSelection(projectReconciliation(mixed), ["40", "41"]).request).toBeNull()
    const split = reconciliationFixture()
    split.moveLines = [...split.moveLines, { ...split.moveLines[0]!, id: 42n, balance: 100, debit: 100, amountResidual: 100 }]
    expect(reconciliationSelection(projectReconciliation(split), ["40", "41"]).request).toBeNull()
  })
  it("preserves a last-cent residual after earlier binary subtraction", () => {
    const source = reconciliationFixture()
    source.bankLines = [{ ...source.line!, amount: 0.01 }]
    source.moveLines = [{ ...source.moveLines[0]!, debit: 100, balance: 100, amountResidual: 100 - 99.99 }]
    expect(reconciliationSelection(projectReconciliation(source), ["40"])).toMatchObject({ difference: 0, request: { amountResidual: 0 } })
  })
  it("excludes refunds, journal entries, missing partners and wrong account roles", () => {
    for (const moveType of ["OutRefund", "InRefund", "Entry", "InInvoice", undefined]) {
      const source = reconciliationFixture()
      source.moves = source.moves.map((row) => ({ ...row, moveType }))
      expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
    }
    for (const patch of [{ partnerId: undefined }, { partnerId: 99n }]) {
      const source = reconciliationFixture()
      source.moveLines = source.moveLines.map((row) => ({ ...row, ...patch }))
      expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
    }
    const source = reconciliationFixture()
    source.accounts = source.accounts.map((row) => ({ ...row, internalType: "Liquidity" }))
    expect(projectReconciliation(source)).toMatchObject({ status: "ready", candidates: [] })
  })
})
