import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and render nothing.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts")
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 600, height: 300 } as object),
  }
})

import {
  chartColor,
  detectAnomalies,
  formatChartTick,
  formatChartValue,
  monthBuckets,
  monthKey,
} from "../lib/chart-format"
import { ComboTrendChart } from "./combo-trend-chart"
import { StepAnomalyChart, anomalyPoints } from "./step-anomaly-chart"
import { RankedBarList, rankItems } from "./ranked-bar-list"
import { SegmentedShareBar, shareRows } from "./segmented-share-bar"
import { RadialGauge, gaugeFraction } from "./radial-gauge"

describe("chart-format", () => {
  test("formats money, percent and compact ticks", () => {
    expect(formatChartValue(1234.5, { kind: "currency", currency: "usd" })).toBe("$1,235")
    expect(formatChartValue(12.345, { kind: "percent" })).toBe("12.3%")
    expect(formatChartValue(1234.567)).toBe("1,234.57")
    expect(formatChartValue(5, { kind: "currency", currency: "??" })).toBe("5")
    expect(formatChartTick(12_300, { kind: "currency", currency: "EUR" })).toBe("€12.3K")
    expect(formatChartTick(1_500_000)).toBe("1.5M")
    expect(formatChartValue(Number.NaN)).toBe("—")
  })

  test("cycles theme colours", () => {
    expect(chartColor(0)).toBe("hsl(var(--chart-1))")
    expect(chartColor(6)).toBe("hsl(var(--chart-2))")
  })

  test("flags robust outliers only", () => {
    expect(detectAnomalies([10, 11, 9, 10, 12, 95, 10])).toEqual([5])
    expect(detectAnomalies([10, 11, 9])).toEqual([])
    expect(detectAnomalies([5, 5, 5, 5, 40])).toEqual([4])
    expect(detectAnomalies([1, 2, 3, 4, 5, 6])).toEqual([])
  })

  test("month buckets end at the current month", () => {
    const buckets = monthBuckets(3, new Date(2026, 9, 18))
    expect(buckets.map((bucket) => bucket.key)).toEqual(["2026-08", "2026-09", "2026-10"])
    expect(buckets[2]!.label).toBe("Oct")
    expect(monthKey(new Date(2026, 0, 31).getTime())).toBe("2026-01")
    expect(buckets[0]!.endMs + 1).toBe(buckets[1]!.startMs)
  })
})

describe("chart primitives", () => {
  const values = [
    { month: "Jan", revenue: 100, expenses: 60, net: 40 },
    { month: "Feb", revenue: 140, expenses: 90, net: 50 },
  ]

  test("combo chart renders bars, a line and both axes", () => {
    const html = renderToStaticMarkup(
      <ComboTrendChart
        values={values}
        xAxisKey="month"
        bars={[
          { key: "revenue", label: "Revenue" },
          { key: "expenses", label: "Expenses" },
        ]}
        line={{ key: "net", label: "Net" }}
      />,
    )
    expect(html).toContain("recharts-bar")
    expect(html).toContain("recharts-line")
    expect(html.match(/recharts-yAxis/g)?.length).toBeGreaterThanOrEqual(2)
  })

  test("step chart marks anomalies", () => {
    const points = [10, 11, 9, 10, 95, 10].map((amount, index) => ({ day: `D${index}`, amount }))
    expect(anomalyPoints(points, "day", "amount").map((point) => point.day)).toEqual(["D4"])
    expect(anomalyPoints(points, "day", "amount", ["D1"]).map((point) => point.day)).toEqual(["D1"])
    const html = renderToStaticMarkup(
      <StepAnomalyChart values={points} xAxisKey="day" series={{ key: "amount", label: "Amount" }} />,
    )
    expect(html).toContain("recharts-area")
    expect(html).toContain("Unusual D4")
  })

  test("ranked list sorts, trims and shows change badges", () => {
    const items = [
      { label: "B", value: 20, change: -5 },
      { label: "A", value: 50, change: 12 },
      { label: "Zero", value: 0 },
    ]
    expect(rankItems(items).map((item) => item.label)).toEqual(["A", "B"])
    const html = renderToStaticMarkup(<RankedBarList items={items} />)
    expect(html.indexOf(">A<")).toBeLessThan(html.indexOf(">B<"))
    expect(html).toContain("+12.0%")
    expect(html).not.toContain("Zero")
    expect(renderToStaticMarkup(<RankedBarList items={[]} emptyLabel="Nothing" />)).toContain("Nothing")
  })

  test("share bar computes shares and a breakdown table", () => {
    const segments = [
      { key: "current", label: "Current" },
      { key: "late", label: "Late" },
    ]
    const rows = [{ label: "AR", values: { current: 75, late: 25 } }]
    expect(shareRows(segments, rows)[0]).toMatchObject({ current: 75, late: 25, total: 100 })
    const html = renderToStaticMarkup(<SegmentedShareBar segments={segments} rows={rows} />)
    expect(html).toContain("recharts-bar")
    expect(html).toContain("75%")
    expect(html).toContain("Late")
  })

  test("gauge clamps its fill and renders three stats", () => {
    expect(gaugeFraction(150, 100)).toBe(1)
    expect(gaugeFraction(5, 0)).toBe(0)
    const html = renderToStaticMarkup(
      <RadialGauge
        value={62}
        max={100}
        label="Collected"
        stats={[
          { label: "Invoiced", value: "$100" },
          { label: "Collected", value: "$62" },
          { label: "Open", value: "$38" },
        ]}
      />,
    )
    expect(html).toContain("62%")
    expect(html).toContain("Invoiced")
    expect(html).toContain("recharts-radial-bar")
  })
})
