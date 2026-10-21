import type { ForensicReport } from "./forensic-report-types"
import type { EntryData, TableColumn } from "./entry-table-types"
import { rowsToCsv } from "./export-csv"

/** Trigger a browser download of arbitrary text content. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.download = filename
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

export function forensicReportsToCsv(reports: ForensicReport[]): string {
  return rowsToCsv(
    ["Report #", "Title", "Category", "Severity", "Status", "Incident date", "Reported by", "Assigned to", "Department", "Tags"],
    reports.map((r) => [
      r.reportNumber,
      r.title,
      r.category,
      r.severity,
      r.status,
      r.incidentDate,
      r.reportedBy,
      r.assignedTo,
      r.department,
      r.tags.join("; "),
    ]),
  )
}

function cellToCsvValue(value: unknown): string | number {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof value === "boolean") return String(value)
  if (value instanceof Date) return value.toISOString()
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return ""
  }
}

export function entryRowsToCsv(columns: TableColumn[], rows: EntryData[]): string {
  const cols = columns.filter((c) => !c.hidden && c.type !== "actions")
  return rowsToCsv(
    cols.map((c) => c.label),
    rows.map((row) => cols.map((c) => cellToCsvValue(row[c.key]))),
  )
}
