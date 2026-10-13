import { describe, expect, it } from "vitest"

import type { DashboardWidget } from "./dashboard-types"
import { rowsToCsv, widgetDataToCsv } from "./export-csv"
import { reportExportSourceProvenance } from "./report-export-provenance"

describe("report CSV export", () => {
  it("preserves a large chart result in deterministic source order", () => {
    const values = Array.from({ length: 1_000 }, (_, index) => ({
      period: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      Revenue: index + 0.25,
      Orders: index,
    }))
    const widget: DashboardWidget = {
      id: "revenue-by-day",
      type: "line-chart",
      title: "Revenue by day",
      width: "full",
      data: {
        xAxisKey: "period",
        series: [{ name: "Revenue", color: "blue" }, { name: "Orders", color: "green" }],
        values,
      },
    }

    const csv = widgetDataToCsv(widget)
    expect(csv).not.toBeNull()
    const lines = csv!.split("\r\n")
    expect(lines).toHaveLength(1_001)
    expect(lines[0]).toBe("period,Revenue,Orders")
    expect(lines[1]).toBe("2026-01-01,0.25,0")
    expect(lines.at(-1)).toBe("2026-04-20,999.25,999")
  })

  it("escapes provenance-bearing labels and values without changing their content", () => {
    expect(rowsToCsv(
      ["source report", "definition", "company"],
      [["Report #42, generated", "Definition \"Quarterly\" #7", "Company\nNorth"]],
    )).toBe(
      'source report,definition,company\r\n"Report #42, generated","Definition ""Quarterly"" #7","Company\nNorth"',
    )
  })

  it("embeds a machine-readable source snapshot ahead of exported rows", () => {
    const widget: DashboardWidget = {
      id: "orders",
      type: "table",
      title: "Orders",
      width: "full",
      data: { columns: [{ key: "state", label: "State" }], rows: [{ state: "sale" }] },
    }
    const provenance = reportExportSourceProvenance({
      organizationId: 7,
      companyId: 11,
      dashboardId: 13,
      widgetId: "orders",
      model: "sale_order",
      domain: '{"state":"sale"}',
      groupBy: "state",
    })
    const csv = widgetDataToCsv(widget, provenance)!
    const [metadata, header, row] = csv.split("\r\n")
    expect(JSON.parse(metadata.replace("# lumiere-provenance:", ""))).toEqual(provenance)
    expect([header, row]).toEqual(["State", "sale"])
  })
})
