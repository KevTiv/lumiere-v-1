import { describe, expect, it } from "vitest"
import { sampleForensicReports } from "./forensic-report-types"
import { entryRowsToCsv, forensicReportsToCsv } from "./ui-exports"

describe("ui exports", () => {
  it("serializes forensic reports with one row per report", () => {
    const csv = forensicReportsToCsv(sampleForensicReports)
    expect(csv.split("\r\n")).toHaveLength(sampleForensicReports.length + 1)
    expect(csv.startsWith("Report #,Title")).toBe(true)
  })

  it("escapes entry cells and skips hidden/action columns", () => {
    const csv = entryRowsToCsv(
      [
        { key: "name", label: "Name", type: "text" },
        { key: "meta", label: "Meta", type: "text", hidden: true },
        { key: "a", label: "Act", type: "actions" },
      ] as never,
      [{ name: 'Say "hi", ok', meta: 1 }],
    )
    expect(csv).toBe('Name\r\n"Say ""hi"", ok"')
  })
})
