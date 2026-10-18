import type { DashboardWidget } from "./dashboard-types"
import { reportExportProvenanceJson, type ReportExportSourceProvenance } from "./report-export-provenance"

function escapeCsvCell(value: string | number): string {
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Serialize headers + rows into a CSV string with proper escaping. */
export function rowsToCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.map(escapeCsvCell).join(",")]
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","))
  }
  return lines.join("\r\n")
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "export"
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = `${sanitizeFilename(filename)}.csv`
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

function seriesValuesToCsv(
  keyColumn: string,
  series: { name: string }[],
  values: Array<Record<string, string | number>>,
): string {
  const headers = [keyColumn, ...series.map((s) => s.name)]
  const rows = values.map((entry) => [
    entry[keyColumn] ?? "",
    ...series.map((s) => entry[s.name] ?? ""),
  ])
  return rowsToCsv(headers, rows)
}

/**
 * Convert a dashboard widget's data into CSV.
 * Returns null for widget types without a tabular representation.
 */
export function widgetDataToCsv(widget: DashboardWidget, provenance?: ReportExportSourceProvenance): string | null {
  let csv: string | null
  switch (widget.type) {
    case "area-chart":
    case "line-chart":
      csv = seriesValuesToCsv(widget.data.xAxisKey, widget.data.series, widget.data.values)
      break
    case "bar-chart":
      csv = seriesValuesToCsv(widget.data.categoryKey, widget.data.series, widget.data.values)
      break
    case "donut-chart":
      csv = rowsToCsv(
        ["name", "value"],
        widget.data.segments.map((s) => [s.name, s.value]),
      )
      break
    case "funnel-chart":
      csv = rowsToCsv(
        ["stage", "value"],
        widget.data.stages.map((s) => [s.name, s.value]),
      )
      break
    case "table":
      csv = rowsToCsv(
        widget.data.columns.map((c) => c.label),
        widget.data.rows.map((row) =>
          widget.data.columns.map((c) => {
            const cell = row[c.key]
            return typeof cell === "string" || typeof cell === "number" ? cell : ""
          }),
        ),
      )
      break
    default:
      return null
  }
  return provenance ? `# lumiere-provenance:${reportExportProvenanceJson(provenance)}\r\n${csv}` : csv
}
