import assert from "node:assert/strict"
import test from "node:test"
import { reportAuthoringKind, scheduleAuthoringPreview, scopeWidgetPreviewRows, templatePageGeometry } from "./report-authoring-model"

test("template preview applies page orientation and detects margins with no printable area", () => {
  assert.deepEqual(templatePageGeometry({ orientation: "Landscape", marginLeft: "12" }), {
    pageWidth: 297, pageHeight: 210, top: 10, bottom: 10, left: 12, right: 7, fits: true,
  })
  assert.equal(templatePageGeometry({ marginLeft: "200", marginRight: "20" }).fits, false)
  assert.equal(templatePageGeometry({ marginTop: "Infinity" }).top, 10)
  assert.equal(templatePageGeometry({ marginTop: "" }).top, 0)
  assert.equal(templatePageGeometry({ marginTop: "-1" }).fits, false)
})

test("schedule preview preserves the exact selected instant and mapper recipient syntax", () => {
  const preview = scheduleAuthoringPreview({ nextRun: "2026-10-20T14:30:00Z", recipients: "a@example.com, b@example.com\nc@example.com", isActive: false })
  assert.equal(preview.nextRun?.toISOString(), "2026-10-20T14:30:00.000Z")
  assert.deepEqual(preview.recipients, ["a@example.com", "b@example.com", "c@example.com"])
  assert.equal(preview.active, false)
  assert.equal(scheduleAuthoringPreview({ nextRun: "bad" }).nextRun, null)
  assert.equal(scheduleAuthoringPreview({}).nextRun, null)
})

test("widget preview admits only exact organization and company rows", () => {
  const selected = { id: 1, organization_id: 9, company_id: 2 }
  const camel = { id: 2, organizationId: 9n, companyId: 2n }
  const rows = [selected, camel, { organization_id: 10, company_id: 2 }, { organization_id: 9, company_id: 3 }, { organization_id: 9 }, { company_id: 2 }]
  assert.deepEqual(scopeWidgetPreviewRows(rows, 9n, "2"), [selected, camel])
  assert.deepEqual(scopeWidgetPreviewRows(rows, 9n, ""), [])
})

test("only supported authoring forms receive a preview", () => {
  assert.equal(reportAuthoringKind("new-financial-report"), "report")
  assert.equal(reportAuthoringKind("new-dashboard-widget"), "widget")
  assert.equal(reportAuthoringKind("archive-report"), null)
})
