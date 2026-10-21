import React from "react"
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { i18n } from "@lumiere/i18n"
import type { FormConfig } from "@lumiere/ui/lib/form-types"
import { MetricAuthoringPreview } from "./metric-authoring-preview"
import { enhanceMetricForm } from "./metric-authoring"

// The UI package preserves JSX for Next; tsx uses the classic transform for those files.
Object.assign(globalThis, { React })

const config = enhanceMetricForm({
  id: "metric", title: "New metric", sections: [{ id: "metric-main", fields: [
    { id: "model", name: "model", type: "text", defaultValue: "account.move" },
    { id: "field", name: "field", type: "text", defaultValue: "amount_total" },
    { id: "aggregation", name: "aggregation", type: "select", options: [] },
    { id: "timePeriod", name: "timePeriod", type: "text" },
    { id: "companyId", name: "companyId", type: "select", options: [{ value: "7", label: "Selected company" }, { value: "8", label: "Hidden company", disabled: true }] },
  ] }],
} satisfies FormConfig, i18n.t)

const markup = (values: Record<string, unknown>) => renderToStaticMarkup(<MetricAuthoringPreview values={values} config={config} />)

test("metric preview renders the edited KPI name, target, calculation and company without a calculated value", () => {
  const html = markup({ name: "Outstanding balances", targetValue: "1200", companyId: "7", field: "amount_residual" })
  assert.match(html, /Outstanding balances/)
  assert.match(html, /1,200/)
  assert.match(html, /Outstanding amount/)
  assert.match(html, /Selected company/)
  assert.match(html, /No calculated value yet/)
  assert.match(html, /Saves a definition only/)
  assert.doesNotMatch(html, /Hidden company/)
})

test("trend and comparison previews show an empty chart instead of invented series", () => {
  for (const metricType of ["Trend", "Comparison"]) {
    const html = markup({ metricType, targetValue: "0", currentValue: 987654, isActive: false })
    assert.match(html, /Calculated values are needed to display this chart/)
    assert.match(html, /The definition will be marked inactive/)
    assert.doesNotMatch(html, /987654/)
  }
})

test("changing local values updates displayed name and period without financial row access", () => {
  const before = markup({ name: "Old metric", timePeriod: "Today", companyId: "8" })
  const after = markup({ name: "Edited metric", timePeriod: "This Year", companyId: "7" })
  assert.match(before, /Old metric/)
  assert.match(before, /Today/)
  assert.match(before, /No company selected/)
  assert.match(after, /Edited metric/)
  assert.match(after, /This year/)
  assert.match(after, /Selected company/)
  assert.doesNotMatch(after, /Old metric/)
})
