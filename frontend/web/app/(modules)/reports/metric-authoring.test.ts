import assert from "node:assert/strict"
import test from "node:test"
import type { TFunction } from "i18next"
import type { FormConfig } from "@lumiere/ui/lib/form-types"
import { enhanceMetricForm, metricChoiceLabel, metricDefinitionPreview } from "./metric-authoring"

const t = ((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key) as TFunction
const config: FormConfig = {
  id: "new-analytics-metric", title: "New metric", sections: [{ id: "main", fields: [
    { id: "model", name: "model", type: "text", defaultValue: "account.move" },
    { id: "field", name: "field", type: "text", defaultValue: "amount_total" },
    { id: "aggregation", name: "aggregation", type: "select", options: [], defaultValue: "Sum" },
    { id: "period", name: "timePeriod", type: "text", defaultValue: "This Month" },
    { id: "refresh", name: "refreshFrequencyMinutes", type: "text", defaultValue: "60" },
    { id: "target", name: "targetValue", type: "text" },
    { id: "company", name: "companyId", type: "select", defaultValue: "7", options: [{ value: "7", label: "Company A" }, { value: "8", label: "Company B", disabled: true }] },
  ] }],
}

test("metric form replaces technical inputs with named choices and preserves company scope", () => {
  const enhanced = enhanceMetricForm(config, t)
  const fields = enhanced.sections[0].fields
  assert.equal(fields.find((field) => field.name === "model")?.type, "select")
  assert.equal(metricChoiceLabel(enhanced, "model", "account.move"), "Accounting documents")
  assert.equal(metricChoiceLabel(enhanced, "field", "amount_total"), "Document total")
  assert.equal(metricChoiceLabel(enhanced, "field", "amount_residual"), "Outstanding amount")
  assert.equal(metricChoiceLabel(enhanced, "companyId", "7"), "Company A")
  assert.equal(metricChoiceLabel(enhanced, "companyId", "8"), null)
  assert.equal(metricChoiceLabel(enhanced, "companyId", "99"), null)
  assert.equal(fields.find((field) => field.name === "companyId")?.defaultValue, "7")
  assert.equal(enhanced.submitLabel, "Save metric definition")
  assert.equal(config.sections[0].fields[0].type, "text")
})

test("definition preview never converts a target or unsaved input into a calculated value", () => {
  const preview = metricDefinitionPreview({ name: "Open balances", targetValue: "1200", field: "amount_residual", aggregation: "Sum", companyId: "7", currentValue: 99999 })
  assert.equal(preview.name, "Open balances")
  assert.equal(preview.target, 1200)
  assert.equal(preview.measure, "amount_residual")
  assert.equal(preview.currentValue, null)
  assert.equal(preview.previousValue, null)
})

test("invalid targets and unsupported sources cannot appear as valid preview values", () => {
  for (const targetValue of ["", " ", "Infinity", "NaN", "bad"]) assert.equal(metricDefinitionPreview({ targetValue }).target, null)
  const preview = metricDefinitionPreview({ model: "arbitrary.table", field: "unsafe", aggregation: "Formula", timePeriod: "Custom", metricType: "Unknown" })
  assert.equal(preview.source, null)
  assert.equal(preview.measure, null)
  assert.equal(preview.aggregation, null)
  assert.equal(preview.period, null)
  assert.equal(preview.metricType, null)
})

test("zero and negative targets remain valid and active status is independent of calculation", () => {
  assert.equal(metricDefinitionPreview({ targetValue: "0", isActive: false }).target, 0)
  assert.equal(metricDefinitionPreview({ targetValue: "-10" }).target, -10)
  assert.equal(metricDefinitionPreview({ isActive: false }).active, false)
  assert.equal(metricDefinitionPreview({ isActive: true }).currentValue, null)
})
