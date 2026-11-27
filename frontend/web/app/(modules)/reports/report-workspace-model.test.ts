import assert from "node:assert/strict"
import test from "node:test"
import { reportAccountingBasis, reportBasisKey, reportDisplayName, reportPeriod, reportWorkspaceHref, reportCanDownload, reportTag, scopedReports, selectedReport } from "./report-workspace-model"

const report = { id: "9007199254740993", organizationId: "7", companyId: "8", state: { tag: "Generated" } }

test("reopening requires one exact report in the selected organization and company", () => {
  const rows = [report, { ...report, id: "9007199254740992" }, { ...report, organizationId: "9" }, { ...report, companyId: "9" }, { id: report.id }]
  const scoped = scopedReports(rows, 7n, 8n)
  assert.equal(scoped.length, 2)
  assert.equal(selectedReport(scoped, report.id), report)
  assert.equal(selectedReport(scoped, "4"), null)
  assert.equal(selectedReport(scoped, "invalid"), null)
  assert.equal(selectedReport([report, report], report.id), null)
  assert.deepEqual(scopedReports(rows, 7n, undefined), [])
})

test("report destinations and return links preserve locked period and list context", () => {
  const query = "tab=reports&source=period-close&company=8&periodId=22&filter=state:generated&search=October"
  const opened = new URL(reportWorkspaceHref(query, report.id), "https://example.test")
  assert.equal(opened.searchParams.get("report"), report.id)
  assert.equal(opened.searchParams.get("source"), "period-close")
  assert.equal(opened.searchParams.get("periodId"), "22")
  assert.equal(opened.searchParams.get("filter"), "state:generated")
  const returned = new URL(reportWorkspaceHref(opened.search), "https://example.test")
  assert.equal(returned.searchParams.has("report"), false)
  assert.equal(returned.searchParams.get("search"), "October")
})

test("state encodings permit downloads again after the first export", () => {
  for (const state of ["generated", { tag: "Generated" }, { exported: [] }, "Exported"]) assert.equal(reportCanDownload({ state }), true)
  for (const state of ["draft", { tag: "Archived" }, null]) assert.equal(reportCanDownload({ state }), false)
  assert.equal(reportTag({ tag: "ProfitAndLoss" }), "profitandloss")
})

test("report periods use the UTC accounting day across timestamp projections", () => {
  const report = {
    date_from: { microsSinceUnixEpoch: "1790812800000000" },
    date_to: "2026-10-31T20:00:00-05:00",
  }
  assert.equal(reportPeriod(report, "en-US"), "Oct 1, 2026 – Nov 1, 2026")
  assert.equal(reportPeriod({ ...report, date_to: "invalid" }, "en-US"), "Oct 1, 2026 – —")
  assert.equal(reportPeriod({ dateTo: "2026-10-31" }, "en-US"), "— – Oct 31, 2026")
  assert.equal(reportPeriod({ dateFrom: "2026-11-01", dateTo: "2026-10-01" }, "en-US"), null)
  assert.equal(reportPeriod({}, "en-US"), null)
})

test("accounting basis recognizes exact tags and leaves missing or unsupported values unavailable", () => {
  for (const targetMove of ["posted", { tag: "Posted" }, { posted: [] }]) {
    assert.equal(reportAccountingBasis({ targetMove }), "posted")
    assert.equal(reportBasisKey({ targetMove }), "reports.workspace.posted")
  }
  assert.equal(reportAccountingBasis({ target_move: { tag: "All" } }), "all")
  assert.equal(reportBasisKey({ target_move: { all: {} } }), "reports.workspace.allEntries")
  for (const targetMove of [null, undefined, "allow", "posted-only", { tag: "Unknown" }]) {
    assert.equal(reportAccountingBasis({ targetMove }), null)
    assert.equal(reportBasisKey({ targetMove }), "reports.workspace.unknown")
  }
})

test("report identity and metadata never expose object coercion or invented identifiers", () => {
  assert.equal(reportDisplayName({ name: { some: "October accounts" } }, "Unavailable"), "October accounts")
  assert.equal(reportDisplayName({ id: "9007199254740993", name: {} }, "Unavailable"), "#9007199254740993")
  assert.equal(reportDisplayName({ name: {}, id: undefined }, "Unavailable"), "Unavailable")
  assert.equal(reportTag({ tag: "PreviousPeriod" }), "previousperiod")
  assert.equal(reportTag({ posted: [], metadata: "unknown" }), "")
})
