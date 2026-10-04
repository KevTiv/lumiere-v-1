import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and render nothing.
// Give it a fixed size so these tests exercise the chart children (axes, series).
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts")
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 600, height: 300 } as object),
  }
})

import { AreaChartWidget } from "./area-chart-widget"
import { BarChartWidget } from "./bar-chart-widget"
import { LineChartWidget } from "./line-chart-widget"

const values = [
  { month: "Jan", revenue: 100 },
  { month: "Feb", revenue: 140 },
]
const series = [{ name: "revenue", color: "hsl(var(--chart-1))" }]

// Regression: recharts@2 with a mismatched react-is drops Fragment-wrapped chart
// children, so axes and series silently disappear.
test("line chart renders axes and series", () => {
  const html = renderToStaticMarkup(
    <LineChartWidget data={{ xAxisKey: "month", series, values }} />,
  )
  expect(html).toContain("recharts-xAxis")
  expect(html).toContain("recharts-yAxis")
  expect(html).toContain("recharts-line")
})

test("area chart renders axes and series", () => {
  const html = renderToStaticMarkup(
    <AreaChartWidget data={{ xAxisKey: "month", series, values }} />,
  )
  expect(html).toContain("recharts-xAxis")
  expect(html).toContain("recharts-area")
})

test.each(["horizontal", "vertical"] as const)("bar chart (%s) renders axes and bars", (layout) => {
  const html = renderToStaticMarkup(
    <BarChartWidget data={{ categoryKey: "month", layout, series, values }} />,
  )
  expect(html).toContain("recharts-xAxis")
  expect(html).toContain("recharts-yAxis")
  expect(html).toContain("recharts-bar")
})
