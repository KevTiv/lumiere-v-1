import { describe, expect, it } from "vitest"
import {
  CSV_BOM,
  EXPORT_ROW_LIMIT,
  buildEntityTableCsv,
  capExportRows,
  escapeCsvField,
  exportCellValue,
  exportFilename,
  exportableColumns,
  guardCsvInjection,
  selectExportRows,
} from "./entity-table-export"

describe("escaping", () => {
  it("quotes fields with commas, quotes and line breaks (RFC 4180)", () => {
    expect(escapeCsvField("plain")).toBe("plain")
    expect(escapeCsvField("a,b")).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"')
  })
})

describe("CSV injection guard", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"])("prefixes %j", (text) => {
    expect(guardCsvInjection(text)).toBe(`'${text}`)
  })
  it("leaves safe text alone", () => {
    expect(guardCsvInjection("Acme = great")).toBe("Acme = great")
  })
  it("guards text cells but keeps negative numbers raw", () => {
    expect(exportCellValue("=1+1", "text")).toBe("'=1+1")
    expect(exportCellValue(-5, "number")).toBe("-5")
  })
})

describe("exportCellValue", () => {
  it("writes booleans as yes / no", () => {
    expect(exportCellValue(true, "boolean")).toBe("yes")
    expect(exportCellValue(false)).toBe("no")
  })
  it("writes numbers, bigints and currency raw", () => {
    expect(exportCellValue(1234.5, "currency")).toBe("1234.5")
    expect(exportCellValue(12345678901234567890n, "number")).toBe("12345678901234567890")
    expect(exportCellValue(12.5, "percent")).toBe("12.5")
  })
  it("writes dates as ISO", () => {
    expect(exportCellValue("2026-03-04T10:00:00.000Z", "date")).toBe("2026-03-04")
    expect(exportCellValue("2026-03-04T10:00:00.000Z", "datetime")).toBe("2026-03-04T10:00:00.000Z")
    expect(exportCellValue({ microsSinceUnixEpoch: 1_772_000_000_000_000n }, "datetime")).toMatch(/^2026-/)
  })
  it("unwraps enums and options and blanks empties", () => {
    expect(exportCellValue({ tag: "Draft" }, "status")).toBe("Draft")
    expect(exportCellValue({ some: "x" })).toBe("x")
    expect(exportCellValue({ none: [] })).toBe("")
    expect(exportCellValue(null)).toBe("")
  })
})

describe("buildEntityTableCsv", () => {
  const columns = [
    { key: "name", label: "Name" },
    { key: "total", label: "Total", type: "currency" as const },
    { key: "ssn", label: "SSN", sensitive: true },
    { key: "active", label: "Active", type: "boolean" as const },
  ]
  const rows = [
    { name: "Ann, Jr.", total: 10, ssn: "123", active: true },
    { name: "=evil()", total: -2, ssn: "456", active: false },
  ]

  it("starts with a BOM and uses CRLF", () => {
    const csv = buildEntityTableCsv(columns, rows)
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv).toContain("\r\n")
  })
  it("keeps column order and drops sensitive columns", () => {
    const lines = buildEntityTableCsv(columns, rows).slice(1).split("\r\n")
    expect(lines[0]).toBe("Name,Total,Active")
    expect(lines[1]).toBe('"Ann, Jr.",10,yes')
    expect(lines[2]).toBe("'=evil(),-2,no")
    expect(exportableColumns(columns).map((c) => c.key)).toEqual(["name", "total", "active"])
  })
  it("honours the visible subset and order it is given", () => {
    const lines = buildEntityTableCsv([columns[3]!, columns[0]!], rows).slice(1).split("\r\n")
    expect(lines[0]).toBe("Active,Name")
    expect(lines[1]).toBe('yes,"Ann, Jr."')
  })
})

describe("row selection and cap", () => {
  const all = [{ id: 1 }, { id: 2 }, { id: 3 }]
  it("exports the selection when there is one, else all filtered rows", () => {
    expect(selectExportRows([all[1]!], all)).toEqual([{ id: 2 }])
    expect(selectExportRows([], all)).toEqual(all)
  })
  it("caps at the limit and reports truncation", () => {
    expect(capExportRows(all)).toEqual({ rows: all, truncated: false })
    const capped = capExportRows(all, 2)
    expect(capped.rows).toHaveLength(2)
    expect(capped.truncated).toBe(true)
    expect(EXPORT_ROW_LIMIT).toBe(50_000)
  })
})

describe("exportFilename", () => {
  it("is <key>-<yyyy-mm-dd>.csv", () => {
    expect(exportFilename("hr:employees", new Date("2026-10-08T12:00:00Z"))).toBe("hr-employees-2026-10-08.csv")
    expect(exportFilename(undefined, new Date("2026-10-08T12:00:00Z"))).toBe("export-2026-10-08.csv")
  })
})
