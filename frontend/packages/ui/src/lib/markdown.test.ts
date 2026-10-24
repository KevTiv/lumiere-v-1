import { describe, expect, it } from "vitest"

import { markdownToPlainText, parseMarkdown, parseMarkdownInline } from "./markdown"

describe("parseMarkdown", () => {
  it("reads every block the rich text toolbar writes", () => {
    expect(parseMarkdown("## Scope\nFirst line\nSecond line\n\n- One\n- Two\n\n1. A\n2. B\n\n> Quoted")).toEqual([
      { kind: "heading", level: 2, children: [{ kind: "text", text: "Scope" }] },
      { kind: "paragraph", lines: [[{ kind: "text", text: "First line" }], [{ kind: "text", text: "Second line" }]] },
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "One" }], [{ kind: "text", text: "Two" }]] },
      { kind: "list", ordered: true, items: [[{ kind: "text", text: "A" }], [{ kind: "text", text: "B" }]] },
      { kind: "quote", lines: [[{ kind: "text", text: "Quoted" }]] },
    ])
  })

  it("reads inline formatting", () => {
    expect(parseMarkdownInline("**Bold** _it_ ~~old~~ `x*y*` [site](https://example.com)")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "Bold" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "it" }] },
      { kind: "text", text: " " },
      { kind: "strike", children: [{ kind: "text", text: "old" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "x*y*" },
      { kind: "text", text: " " },
      { kind: "link", href: "https://example.com", children: [{ kind: "text", text: "site" }] },
    ])
  })

  it("leaves identifiers with underscores alone", () => {
    expect(parseMarkdownInline("see sale_order_line and SO_2024_")).toEqual([
      { kind: "text", text: "see sale_order_line and SO_2024_" },
    ])
  })

  it("never turns an unsafe link into a link", () => {
    expect(parseMarkdownInline("[click](javascript:alert(1))")).toEqual([
      { kind: "text", text: "click" },
      { kind: "text", text: ")" },
    ])
  })
})

describe("markdownToPlainText", () => {
  it("drops the markers and keeps the words on one line", () => {
    expect(markdownToPlainText("## Scope\n**Deliver** by _Friday_\n- [Spec](https://example.com)")).toBe(
      "Scope Deliver by Friday Spec"
    )
  })

  it("keeps plain text unchanged", () => {
    expect(markdownToPlainText("Customer prefers email")).toBe("Customer prefers email")
  })
})
