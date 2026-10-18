import { describe, expect, it } from "vitest"
import { fileKindOf, formatFileSize } from "./file-kind"

describe("fileKindOf", () => {
  it("reads the MIME type first", () => {
    expect(fileKindOf("application/pdf", "x.bin")).toBe("pdf")
    expect(fileKindOf("image/png", "")).toBe("image")
    expect(fileKindOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "")).toBe("spreadsheet")
    expect(fileKindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "")).toBe("document")
  })

  it("falls back to the extension for generic MIME types", () => {
    expect(fileKindOf("application/octet-stream", "Q3 budget.XLSX")).toBe("spreadsheet")
    expect(fileKindOf("", "deck.pptx")).toBe("presentation")
    expect(fileKindOf(undefined, "noextension")).toBe("other")
  })
})

describe("formatFileSize", () => {
  it("formats bytes in plain units", () => {
    expect(formatFileSize(512)).toBe("512 B")
    expect(formatFileSize(1536)).toBe("1.5 KB")
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB")
    expect(formatFileSize(-1)).toBe("—")
    expect(formatFileSize(10n)).toBe("10 B")
  })
})
