import { expect, test } from "vitest"
import { overviewDashboardDefinition, type DashboardData, type DashboardDefinition, type OverviewDashboardData } from "@lumiere/presentation-core"
import { overviewDashboardWebOptions, toDashboardSections } from "./presentation-dashboard"

const data: OverviewDashboardData = {
  metrics: {
    revenue: { value: "$1,200", change: 12 },
    "open-sales-orders": { value: "3", change: -2 },
    "open-tasks": { value: "4" }, contacts: { value: "5" },
  },
  series: { revenue: [{ label: "Jan", value: 100 }, { label: "Feb", value: 120 }] },
  tables: { "needs-attention": [{ reference: "Overdue invoices", amount: "2", status: "$20" }] },
}
const t = (key: string) => `translated:${key}`

test("preserves Overview metric, bar chart, table and harness contracts", () => {
  const sections = toDashboardSections(overviewDashboardDefinition, data, t, overviewDashboardWebOptions)
  expect(sections.map((section) => section.id)).toEqual(["overview-kpis", "overview-revenue", "overview-attention"])
  expect(sections[0]!.widgets).toMatchObject([{
    id: "overview-stat-cards", type: "stat-cards", width: "full", title: t("overview.dashboard.keyMetrics"),
    data: { stats: [
      { label: t("sales.dashboard.widgets.revenue"), value: "$1,200", change: 12, icon: "BarChart2", testId: "overview-stat-revenue" },
      { label: t("overview.dashboard.stats.openSalesOrders"), value: "3", change: -2, icon: "ShoppingCart", testId: "overview-stat-open-sales-orders" },
      { label: t("overview.dashboard.stats.openTasks"), value: "4", icon: "CheckSquare", testId: "overview-stat-open-tasks" },
      { label: t("crm.contacts.title"), value: "5", icon: "Users", testId: "overview-stat-contacts" },
    ] },
  }])
  expect(sections[1]!.widgets).toMatchObject([{
    id: "overview-sales-trend", type: "bar-chart", width: "full", title: t("overview.dashboard.widgets.salesTrend"),
    data: { categoryKey: "month", series: [{ name: "revenue", color: "hsl(var(--chart-1))" }],
      values: [{ month: "Jan", revenue: 100 }, { month: "Feb", revenue: 120 }] },
  }])
  expect(sections[2]).toMatchObject({
    title: t("overview.dashboard.sections.attention"), widgets: [{
      id: "overview-needs-attention", type: "table", width: "full", title: t("overview.dashboard.sections.attention"),
      data: { columns: [
        { key: "reference", label: t("overview.dashboard.tables.reference") },
        { key: "amount", label: t("overview.dashboard.tables.amount"), align: "right" },
        { key: "status", label: t("overview.dashboard.tables.status") },
      ], rows: [{ reference: "Overdue invoices", amount: "2", status: "$20" }] },
    }],
  })
})

test("JSON fixtures produce identical output without aliasing table inputs", () => {
  const definition: DashboardDefinition = JSON.parse(JSON.stringify(overviewDashboardDefinition))
  const input: DashboardData = JSON.parse(JSON.stringify(data))
  const before = JSON.stringify({ definition, input })
  const sections = toDashboardSections(definition, input, t, overviewDashboardWebOptions)
  expect(sections).toEqual(toDashboardSections(overviewDashboardDefinition, data, t, overviewDashboardWebOptions))
  const table = sections[2]!.widgets[0]!
  if (table.type !== "table") throw new Error("expected table")
  table.data.rows[0]!.status = "changed by renderer"
  expect(JSON.stringify({ definition, input })).toBe(before)
})

test.each([
  ["metric", { ...data, metrics: {} }, "revenue"],
  ["series", { ...data, series: {} }, "revenue"],
  ["table", { ...data, tables: {} }, "needs-attention"],
] as const)("rejects missing %s bindings rather than hiding wiring errors", (_kind, input, binding) => {
  expect(() => toDashboardSections(overviewDashboardDefinition, input, t)).toThrow(`missing dashboard binding ${binding}`)
})

test("empty series and table bindings remain legitimate empty state", () => {
  const sections = toDashboardSections(overviewDashboardDefinition, {
    ...data, series: { revenue: [] }, tables: { "needs-attention": [] },
  }, t)
  expect(sections[1]!.widgets[0]).toMatchObject({ data: { values: [] } })
  expect(sections[2]!.widgets[0]).toMatchObject({ data: { rows: [] } })
})

test("rejects a missing declared table column but accepts an explicit null cell", () => {
  expect(() => toDashboardSections(overviewDashboardDefinition, {
    ...data, tables: { "needs-attention": [{ reference: "Invoice", amount: "1" }] },
  }, t)).toThrow("missing dashboard binding status")
  expect(() => toDashboardSections(overviewDashboardDefinition, {
    ...data, tables: { "needs-attention": [{ reference: "Invoice", amount: "1", status: null }] },
  }, t)).not.toThrow()
})

test("joins series on category labels and retains distinct series data keys", () => {
  const definition: DashboardDefinition = {
    schemaVersion: 1, id: "paired", titleKey: "title", descriptionKey: "description",
    sections: [{ id: "trend", widgets: [{ kind: "time-series", id: "trend", titleKey: "trend",
      series: [
        { id: "revenue", binding: "revenue" },
        { id: "cost", binding: "cost" },
      ],
    }] }],
  }
  const sections = toDashboardSections(definition, { metrics: {}, tables: {}, series: {
    revenue: [{ label: "Jan", value: 100 }, { label: "Feb", value: 120 }],
    cost: [{ label: "Feb", value: 60 }, { label: "Jan", value: 40 }],
  } }, t)
  expect(sections[0]!.widgets[0]).toMatchObject({ data: {
    series: [{ name: "revenue" }, { name: "cost" }],
    values: [{ label: "Jan", revenue: 100, cost: 40 }, { label: "Feb", revenue: 120, cost: 60 }],
  } })
})
