import { describe, expect, it } from "vitest"
import { analyzeCsv, buildCsvTemplate, canSubmitCsvImport } from "./csv-import-preview"

const columns = { required: ["name", "employee_id"], optional: ["description"] }

describe("analyzeCsv", () => {
  it("counts rows, limits the preview and lower-cases headers", () => {
    const csv = "Name,Employee_ID\nA,1\nB,2\nC,3\n"
    const analysis = analyzeCsv(csv, columns, 2)
    expect(analysis.headers).toEqual(["name", "employee_id"])
    expect(analysis.rowCount).toBe(3)
    expect(analysis.previewRows).toEqual([["A", "1"], ["B", "2"]])
    expect(analysis.missingRequired).toEqual([])
    expect(canSubmitCsvImport(analysis)).toBe(true)
  })

  it("reports missing required and unknown columns, tolerating a BOM and CRLF", () => {
    const analysis = analyzeCsv("﻿name,colour\r\nA,red\r\n", columns)
    expect(analysis.headers).toEqual(["name", "colour"])
    expect(analysis.missingRequired).toEqual(["employee_id"])
    expect(analysis.unknownColumns).toEqual(["colour"])
    expect(canSubmitCsvImport(analysis)).toBe(false)
  })

  it("blocks a file with a header but no rows", () => {
    expect(canSubmitCsvImport(analyzeCsv("name,employee_id\n", columns))).toBe(false)
  })

  it("accepts any header when no columns are declared", () => {
    const analysis = analyzeCsv("a,b\n1,2\n")
    expect(analysis.missingRequired).toEqual([])
    expect(analysis.unknownColumns).toEqual([])
    expect(canSubmitCsvImport(analysis)).toBe(true)
  })

  it("throws on an empty file", () => {
    expect(() => analyzeCsv("")).toThrow()
  })

  it("never submits before a file is analysed", () => {
    expect(canSubmitCsvImport(null)).toBe(false)
  })
})

describe("buildCsvTemplate", () => {
  it("lists required then optional headers", () => {
    expect(buildCsvTemplate(columns)).toBe("name,employee_id,description\n")
  })
})
