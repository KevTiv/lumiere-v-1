import assert from "node:assert/strict"
import test from "node:test"
import { toCreateDashboardWidgetPayload } from "./reports-module-form-payloads"
import { toCreateDashboardWidgetParams } from "@lumiere/erp-shared/reports-dashboard-params"
import { resolveStoredDashboard } from "@lumiere/ui/lib/stored-dashboard-resolver"
import { enhanceWidgetAuthoringForm } from "../app/(modules)/reports/report-authoring-model"
import type { FormConfig } from "@lumiere/ui/lib/form-types"

const config: FormConfig = { id: "new-dashboard-widget", title: "New widget", sections: [{ id: "main", fields: [
  { id: "dataSource", name: "dataSource", type: "text", required: true },
  { id: "widgetType", name: "widgetType", type: "select", options: [{ value: "kpi", label: "KPI" }, { value: "chart", label: "Chart" }, { value: "table", label: "Table" }, { value: "metric", label: "Metric" }] },
] }] }
const t = (key: string, options?: { defaultValue: string }) => options?.defaultValue ?? key

test("widget editor supplies source selection and valid default chart grouping", () => {
  const enhanced = enhanceWidgetAuthoringForm(config, t)
  const fields = enhanced.sections[0]!.fields
  const source = fields.find((field) => field.name === "dataSource")!
  assert.equal(source.type, "select")
  assert.equal(source.defaultValue, "account_move")
  assert.equal(fields.find((field) => field.name === "aggregation")?.defaultValue, "count")
  assert.equal(fields.find((field) => field.name === "groupBy")?.defaultValue, "state")
  assert.deepEqual(fields.find((field) => field.name === "chartType")?.visibleWhen, { field: "widgetType", equals: "chart" })
  assert.equal(config.sections[0]!.fields[0]!.type, "text")
})

test("chart editor settings survive payload mapping into the existing generated contract", () => {
  const payload = toCreateDashboardWidgetPayload({ name: "Payments by status", companyId: "2", widgetType: "chart", dataSource: "account_payment", aggregation: "count", groupBy: "state", chartType: "donut" })
  const params = toCreateDashboardWidgetParams(payload)
  assert.equal(params.model, "account_payment")
  assert.deepEqual(params.widgetType, { tag: "Chart" })
  assert.equal(params.aggregation, "count")
  assert.equal(params.groupBy, "state")
  assert.equal(params.chartType, "donut")
  assert.deepEqual(JSON.parse(params.domain!), { company_id: "2" })
  const resolution = resolveStoredDashboard([{ ...params, id: 1 }], [1], { account_payment: [
    { id: 1, company_id: 2, state: "posted" }, { id: 2, company_id: 3, state: "posted" },
  ] })
  const chart = resolution.widgets[0]!
  assert.equal(chart.type, "donut-chart")
  if (chart.type === "donut-chart") assert.equal(chart.data.segments[0]?.value, 1)
  assert.equal(payload.companyId, "2")
})
