import React from "react"
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { i18n } from "@lumiere/i18n"
import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
import { ReportAuthoringPreview } from "./report-authoring-preview"

const config = (id: string): FormConfig => ({ id, title: "Create report", sections: [{ id: "main", fields: [
  { id: "companyId", name: "companyId", type: "select", options: [{ value: "2", label: "Company Two" }] },
  { id: "reportType", name: "reportType", type: "select", options: [{ value: "trialBalance", label: "Trial balance" }] },
] }] })
const markup = (id: string, values: FormValues) => renderToStaticMarkup(<ReportAuthoringPreview values={values} config={config(id)} organizationId={9n} />)
// Some shared UI modules use the classic JSX transform in the Node test loader.
Object.assign(globalThis, { React })
void i18n

test("financial report preview changes columns and keeps all amounts structural", () => {
  const html = markup("new-financial-report", { name: "October report", reportType: "trialBalance", companyId: "2", showDebitCredit: true, comparisonMode: "previous_year", amount: 99887766 })
  assert.match(html, /October report/)
  assert.match(html, /Company Two/)
  assert.match(html, /Debit/)
  assert.match(html, /Credit/)
  assert.match(html, /Layout preview only/)
  assert.doesNotMatch(html, /99887766/)
})

test("template name is escaped and the preview reflects page orientation", () => {
  const html = markup("new-report-template", { name: "<script>alert(1)</script>", orientation: "Landscape", marginTop: "20", headerLine: true, footerLine: false })
  assert.match(html, /297 \/ 210/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /A4 reference/)
})

test("dashboard preview does not claim that unsaved placeholders are saved widgets", () => {
  const html = markup("new-dashboard", { name: "Finance board", description: "Monthly view" })
  assert.match(html, /Finance board/)
  assert.match(html, /Monthly view/)
  assert.match(html, /Start with an empty dashboard/)
  assert.match(html, /Save the dashboard, then use Add widget/)
  assert.match(html, /Unsaved/)
})


test("schedule preview shows selected delivery without promising later run dates", () => {
  const html = markup("new-scheduled-report", { name: "Weekly finance", nextRun: "2026-10-20T14:30:00Z", frequency: "Weekly", recipients: "a@example.com, b@example.com", attachmentFormat: "PDF", isActive: false })
  assert.match(html, /Weekly finance/)
  assert.match(html, /Paused schedule/)
  assert.match(html, /a@example.com/)
  assert.match(html, /b@example.com/)
  assert.match(html, /Selected next run/)
  assert.match(html, /Future run dates depend on the scheduler/)
})
