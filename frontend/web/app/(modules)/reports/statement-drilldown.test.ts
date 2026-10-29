import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { filterStatementJournalItems, parseStatementDrilldown, statementJournalHref, statementReturnHref } from "./statement-drilldown"

const report = {
  id: "9007199254741001", organizationId: "42", companyId: "7", dateFrom: "2026-10-01", dateTo: "2026-10-31",
  targetMove: "posted", filterAccountIds: [], filterAnalyticAccountIds: [], filterPartnerIds: [], filterJournalIds: [],
}
const href = statementJournalHref("12", report, "/reports?tab=reports&report=9007199254741001")!
const parsed = parseStatementDrilldown(new URL(href, "https://lumiere.invalid").searchParams)
if (parsed.status !== "ready") throw new Error("fixture context unavailable")
const context = parsed.context
const base = { organizationId: 42, companyId: 7, accountId: 12, parentState: "Posted", date: "2026-10-15", journalId: 2, partnerId: null, analyticAccountId: null }

describe("saved statement journal drill-down", () => {
  it("carries exact report identity, company, interval, basis and a local return destination", () => {
    assert.equal(context.reportId, report.id)
    assert.equal(context.companyId, "7")
    assert.equal(context.accountId, "12")
    assert.equal(context.fromMicros, String(BigInt(Date.parse("2026-10-01")) * 1000n))
    assert.equal(context.toMicros, String(BigInt(Date.parse("2026-10-31")) * 1000n))
    assert.equal(context.basis, "posted")
    assert.equal(context.returnHref, `/reports?tab=reports&report=${report.id}`)
  })

  it("rejects partial, ambiguous or unsafe navigation rather than showing a broader ledger", () => {
    for (const suffix of ["", "&statementBasis=all"]) {
      const params = new URL(href + suffix, "https://lumiere.invalid").searchParams
      if (!suffix) params.delete("statementTo")
      assert.equal(parseStatementDrilldown(params).status, "invalid")
    }
    for (const value of ["//evil.invalid", "https://evil.invalid", "/reports\\evil", "/reports#x", "/accounting"])
      assert.equal(statementReturnHref(value), null)
    assert.equal(statementJournalHref("12", { ...report, companyId: undefined }, "/reports"), null)
    assert.equal(statementJournalHref(null, report, "/reports"), null)
    assert.equal(parseStatementDrilldown(new URLSearchParams()).status, "none")
  })

  it("filters current authorized rows to the exact account, company, period and posted basis", () => {
    const result = filterStatementJournalItems([
      { ...base, name: "included" }, { ...base, companyId: 8, name: "other company" },
      { ...base, organizationId: 43, name: "other org" }, { ...base, accountId: 13, name: "other account" },
      { ...base, date: "2026-09-30", name: "prior period" }, { ...base, date: "2026-11-01", name: "later period" },
      { ...base, parentState: "Draft", name: "draft" },
    ], [report], context, 42n, 7n)
    assert.equal(result.status, "ready")
    assert.deepEqual(result.rows.map((row) => row.name), ["included"])
  })

  it("retains explicit report dimensions and never broadens missing or stale report scope", () => {
    const rows = [{ ...base, partnerId: 1 }, { ...base, partnerId: 2 }]
    const restricted = { ...report, filterPartnerIds: [1] }
    const restrictedContext = { ...context, dimensionSignature: "[[],[],[\"1\"],[]]" }
    assert.deepEqual(filterStatementJournalItems(rows, [restricted], restrictedContext, 42n, 7n).rows, [rows[0]])
    assert.equal(filterStatementJournalItems(rows, [restricted], context, 42n, 7n).status, "invalid")
    assert.equal(filterStatementJournalItems(rows, [{ ...report, dateTo: "2026-11-30" }], context, 42n, 7n).status, "invalid")
    assert.equal(filterStatementJournalItems(rows, [{ ...report, filterPartnerIds: undefined }], context, 42n, 7n).status, "unavailable")
    assert.equal(filterStatementJournalItems(rows, [], context, 42n, 7n).status, "unavailable")
    assert.equal(filterStatementJournalItems(rows, [report, report], context, 42n, 7n).status, "unavailable")
    assert.equal(filterStatementJournalItems(rows, [report], context, 42n, 8n).status, "invalid")
    assert.equal(filterStatementJournalItems([{ ...base, date: undefined }], [report], context, 42n, 7n).status, "unavailable")
  })

  it("allows drafts only for the explicit all-entry basis", () => {
    const allReport = { ...report, targetMove: "all" }
    const allContext = { ...context, basis: "all" as const }
    assert.equal(filterStatementJournalItems([{ ...base, parentState: "Draft" }], [allReport], allContext, 42n, 7n).rows.length, 1)
  })
})
