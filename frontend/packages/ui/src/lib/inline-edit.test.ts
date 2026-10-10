import { describe, expect, it } from "vitest"

import { isUnchangedInline, parseInlineValue } from "./inline-edit"

describe("inline edit values", () => {
  it("parses numbers and rejects empty or non-numeric input", () => {
    expect(parseInlineValue("number", " 12.5 ")).toEqual({ ok: true, value: 12.5 })
    expect(parseInlineValue("number", "")).toMatchObject({ ok: false })
    expect(parseInlineValue("number", "abc")).toMatchObject({ ok: false })
  })

  it("trims text and keeps select values as they are", () => {
    expect(parseInlineValue("text", "  hi ")).toEqual({ ok: true, value: "hi" })
    expect(parseInlineValue("select", "Open")).toEqual({ ok: true, value: "Open" })
  })

  it("treats an equal value as unchanged", () => {
    expect(isUnchangedInline("a", "a")).toBe(true)
    expect(isUnchangedInline(5, 5)).toBe(true)
    expect(isUnchangedInline(5, 6)).toBe(false)
    expect(isUnchangedInline(null, "")).toBe(true)
    expect(isUnchangedInline(null, "x")).toBe(false)
  })
})
