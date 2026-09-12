import assert from "node:assert/strict"
import test from "node:test"
import {
  overviewDashboardDefinition,
  type DashboardDefinition,
  type DashboardWidgetDefinition,
  type OverviewDashboardData,
} from "./index"

test("overview definition is JSON serializable and preserves order", () => {
  const roundTripped = JSON.parse(JSON.stringify(overviewDashboardDefinition)) as DashboardDefinition
  assert.deepEqual(roundTripped, overviewDashboardDefinition)
  assert.deepEqual(roundTripped.sections.map((section) => section.id), ["overview-kpis", "overview-revenue", "overview-attention"])
})

test("overview bindings cover every declared widget input", () => {
  const data: OverviewDashboardData = {
    metrics: {
      revenue: { value: "$12,400", change: 4.2 },
      "open-sales-orders": { value: 12, change: -1.5 },
      "open-tasks": { value: 7 },
      contacts: { value: 31 },
    },
    series: {
      revenue: [{ label: "Jan", value: 12_400 }],
    },
    tables: {
      "needs-attention": [{ reference: "INV-001", amount: "$120", status: "Due" }],
    },
  }
  const metricGroup = overviewDashboardDefinition.sections[0].widgets[0]
  assert.equal(metricGroup.kind, "metric-group")
  if (metricGroup.kind === "metric-group") {
    assert.equal(metricGroup.metrics.length, 4)
    for (const metric of metricGroup.metrics) assert.ok(data.metrics[metric.binding])
  }
  const series = overviewDashboardDefinition.sections[1].widgets[0]
  assert.equal(series.id, "overview-sales-trend")
  if (series.kind === "time-series") {
    for (const binding of series.series) assert.ok(data.series[binding.binding])
  }
  const table = overviewDashboardDefinition.sections[2].widgets[0]
  assert.equal(table.id, "overview-needs-attention")
  if (table.kind === "report-table") {
    assert.ok(data.tables[table.binding])
    assert.deepEqual(table.columns.map((column) => column.id), ["reference", "amount", "status"])
    for (const row of data.tables[table.binding]) {
      for (const column of table.columns) assert.equal(typeof row[column.id], "string")
    }
  }
})

test("definition serialization contains no renderer platform fields", () => {
  const serialized = JSON.stringify(overviewDashboardDefinition)
  for (const field of ["icon", "testId", "url", "className", "transport"]) assert.equal(serialized.includes(field), false)
})

// Compile-time contract checks: these must remain errors as the model evolves.
const missingOverviewMetric: OverviewDashboardData = {
  // @ts-expect-error Overview requires all four metric bindings.
  metrics: { revenue: { value: 1 }, "open-sales-orders": { value: 1 }, "open-tasks": { value: 1 } },
  series: { revenue: [] },
  tables: { "needs-attention": [] },
}
void missingOverviewMetric

const wrongSeriesValue: OverviewDashboardData = {
  metrics: { revenue: { value: 1 }, "open-sales-orders": { value: 1 }, "open-tasks": { value: 1 }, contacts: { value: 1 } },
  // @ts-expect-error Series points use numeric values, never renderer strings.
  series: { revenue: [{ label: "Jan", value: "12" }] },
  tables: { "needs-attention": [] },
}
void wrongSeriesValue

// @ts-expect-error Arbitrary component widgets are not part of the shared model.
const invalidWidgetKind: DashboardWidgetDefinition["kind"] = "custom"
void invalidWidgetKind
