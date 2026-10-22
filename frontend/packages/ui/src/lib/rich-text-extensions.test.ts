import { Editor } from "@tiptap/react"
import { describe, expect, it } from "vitest"

import { createRichTextExtensions, serializeRichTextMarkdown } from "./rich-text-extensions"

function roundTrip(markdown: string): string {
  const editor = new Editor({ extensions: createRichTextExtensions(), content: markdown, contentType: "markdown" })
  const result = serializeRichTextMarkdown(editor)
  editor.destroy()
  return result
}

describe("serializeRichTextMarkdown", () => {
  it.each([
    "**Bold** and *italic* with ~~strike~~",
    "- one\n- two",
    "1. First\n2. Second",
    "- [ ] todo\n- [x] done",
    "## Heading\n\nBody",
    "> Quoted",
    "[Docs](https://example.com)",
    "Hello {{customer.name}}, total: 5 USD",
    "snake_case_value",
    "R&D > budget < forecast",
    "Para one\n\nPara two",
    "Use `a &amp; b` literally",
  ])("round-trips %j unchanged", (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it("keeps emphasis-significant characters escaped", () => {
    expect(roundTrip("a\\*b")).toBe("a\\*b")
  })

  it("returns an empty string for an empty document", () => {
    expect(roundTrip("")).toBe("")
  })
})
