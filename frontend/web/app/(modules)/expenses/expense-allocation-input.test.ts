import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { allocationLookupRows, expenseAllocationLines, savedExpenseAllocationDrafts, expenseAllocationFingerprint } from "./expense-allocation-input"

const projects = new Set(["9007199254740993", "2"])
const accounts = new Set(["3"])
const line = (patch: object = {}) => ({ projectId: "9007199254740993", analyticAccountId: "", sharePercent: "100", billable: true, ...patch })
const parse = (value: unknown) => expenseAllocationLines(value, projects, accounts, "Invalid allocation row", "Shares must total 100%")

describe("expense allocation replacement", () => {
  it("accepts more than four rows and retains exact IDs and billable choices", () => {
    const result = parse(Array.from({ length: 5 }, (_, index) => line({ sharePercent: "20", billable: index % 2 === 0 })))
    assert.equal(result.length, 5)
    assert.equal(result[0].projectId, 9007199254740993n)
    assert.equal(result[1].billable, false)
    assert.equal(result[0].analyticAccountId, undefined)
  })
  it("allows either a project or an analytic account and verifies both when supplied", () => {
    assert.equal(parse([line({ projectId: "", analyticAccountId: "3" })])[0].analyticAccountId, 3n)
    assert.equal(parse([line({ analyticAccountId: "3" })])[0].projectId, 9007199254740993n)
    assert.throws(() => parse([line({ projectId: "", analyticAccountId: "" })]), /Invalid allocation/)
    assert.throws(() => parse([line({ analyticAccountId: "bad" })]), /Invalid allocation/)
  })
  it("rejects invalid supplied relations rather than silently treating them as absent", () => {
    for (const id of ["1.2", "-1", "0", "18446744073709551616", 9007199254740992, "4", { id: 2 }]) {
      assert.throws(() => parse([line({ projectId: id })]), /Invalid allocation/)
    }
  })
  it("does not silently drop malformed, zero, negative, nonfinite or out-of-range rows", () => {
    for (const share of ["", "NaN", "Infinity", NaN, Infinity, "0", "-1", "101", null, false]) {
      assert.throws(() => parse([line({ sharePercent: share })]), /Invalid allocation/)
    }
    for (const value of [null, {}, [], [null], [line(), { sharePercent: "0" }]]) assert.throws(() => parse(value), /Invalid allocation/)
    assert.throws(() => parse([line({ billable: "true" })]), /Invalid allocation/)
  })
  it("requires the canonical 100% tolerance across the entire vector", () => {
    assert.throws(() => parse([line({ sharePercent: "50" })]), /Shares must total/)
    assert.throws(() => parse([line({ sharePercent: "60" }), line({ sharePercent: "41" })]), /Shares must total/)
    assert.equal(parse([line({ sharePercent: "33.333333" }), line({ sharePercent: "33.333333" }), line({ sharePercent: "33.333334" })]).length, 3)
  })
  it("offers only explicit same-company identities and active analytic accounts", () => {
    const rows = [
      { id: "9007199254740993", organizationId: 1n, companyId: 2n, active: true },
      { id: 2, organizationId: 1n, companyId: 3n, active: true },
      { id: 3, organizationId: 4n, companyId: 2n, active: true },
      { id: 4, organizationId: 1n, active: true },
      { id: 5, organizationId: 1n, companyId: 2n, active: false },
      { id: 6, organizationId: 1n, companyId: 2n },
    ]
    assert.deepEqual(allocationLookupRows(rows, 1n, 2n, true).map((row) => String(row.id)), ["9007199254740993"])
    assert.deepEqual(allocationLookupRows(rows, 1n, 0n), [])
    assert.throws(() => expenseAllocationLines([line()], new Set(), accounts, "Unavailable project", "Total"), /Unavailable project/)
  })
})

const saved = (patch: object = {}) => ({ id: "9007199254740993", organizationId: 1n, companyId: 2n, expenseId: 7n,
  projectId: "9007199254740993", analyticAccountId: null, sharePercent: 100, amount: 123.456789,
  billable: false, metadata: '{"costCenter":"A"}', ...patch })
const read = (rows: ReturnType<typeof saved>[]) => savedExpenseAllocationDrafts(rows, 1n, 2n, 7n, "Cannot verify saved allocations")

describe("expense allocation saved read", () => {
  it("round trips exact saved identifiers, share precision and opaque metadata", () => {
    const drafts = read([saved({ sharePercent: 33.333333333 }), saved({ id: "4", sharePercent: 66.666666667 })])
    assert.equal(drafts[0].sharePercent, "33.333333333")
    assert.equal(drafts[0].projectId, "9007199254740993")
    const parsed = parse(drafts)
    assert.equal(parsed[0].metadata, '{"costCenter":"A"}')
    assert.equal(parsed[0].billable, false)
    assert.equal(parsed[0].projectId, 9007199254740993n)
    assert.deepEqual(read([]), [])
  })
  it("rejects foreign, duplicate and masked rows instead of silently starting replacement data", () => {
    for (const patch of [{ organizationId: 3n }, { companyId: 3n }, { expenseId: 8n }, { projectId: undefined },
      { projectId: null }, { analyticAccountId: "bad" }, { sharePercent: "100" }, { sharePercent: NaN },
      { amount: undefined }, { billable: undefined }, { metadata: {} }, { id: 9007199254740992 }]) {
      assert.throws(() => read([saved(patch)]), /Cannot verify/)
    }
    const masked = saved()
    delete (masked as { metadata?: unknown }).metadata
    assert.throws(() => read([masked]), /Cannot verify/)
    assert.throws(() => read([saved(), saved()]), /Cannot verify/)
  })
  it("preserves an unavailable relation for correction and detects any saved change independent of row order", () => {
    assert.equal(read([saved({ projectId: "999" })])[0].projectId, "999")
    const first = saved()
    const second = saved({ id: "4" })
    assert.equal(expenseAllocationFingerprint([first, second]), expenseAllocationFingerprint([second, first]))
    for (const patch of [{ amount: 123.45678 }, { sharePercent: 99.99 }, { billable: true }, { metadata: null }, { id: "5" }]) {
      assert.notEqual(expenseAllocationFingerprint([first]), expenseAllocationFingerprint([saved(patch)]))
    }
  })
})
