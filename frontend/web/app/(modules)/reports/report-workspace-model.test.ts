import assert from "node:assert/strict"
import test from "node:test"
import { reportDate, reportWorkspaceHref, reportCanDownload, reportTag, scopedReports, selectedReport } from "./report-workspace-model"

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

test("report dates retain their UTC accounting day and missing values remain unknown", () => {
  assert.equal(reportDate("2026-10-01T00:00:00Z", "en-US"), "Oct 1, 2026")
  assert.equal(reportDate({ microsSinceUnixEpoch: "1790812800000000" }, "en-US"), "Oct 1, 2026")
  assert.equal(reportDate(undefined, "en-US"), "—")
  assert.equal(reportDate("not-a-date", "en-US"), "—")
})
