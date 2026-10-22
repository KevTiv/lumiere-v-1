import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { DashboardWidgetRenderer } from "./dashboard-widget-renderer"
import type { BarChartWidget } from "../lib/dashboard-types"

const zero: BarChartWidget = { id: "zero", type: "bar-chart", title: "Known zero balances", width: "full", data: { categoryKey: "bucket", series: [{ name: "Invoices", color: "hsl(var(--chart-1))" }], values: [{ bucket: "Current", Invoices: 0 }] } }
test("zero-valued financial series can state their domain meaning without changing the shared default", () => {
  const customized = renderToStaticMarkup(<DashboardWidgetRenderer widget={zero} widthClass="" emptyMessage="All plotted amounts are zero for this view." />)
  expect(customized).toContain("All plotted amounts are zero for this view.")
  expect(customized).not.toContain("No data for this period yet.")
  const original = renderToStaticMarkup(<DashboardWidgetRenderer widget={zero} widthClass="" />)
  expect(original).toContain("No data for this period yet.")
})
