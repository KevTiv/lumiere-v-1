import { describe, expect, it } from "vitest"

import { parseSectionTemplateInput, serializeSectionsForTemplate } from "./section-template"

const sections = [
  { id: 2n, title: "Pricing", content: "Our prices", sequence: 40, status: "draft", revision: 3 },
  { id: 1n, title: "Summary", content: "Overview", sequence: 10, status: "final", aiSuggestion: "x" },
]

/** Mirrors how apply_proposal_template reads sections_json. */
function applyLikeReducer(sectionsJson: string) {
  const parsed = JSON.parse(sectionsJson)
  if (!Array.isArray(parsed)) throw new Error("Template sections_json must be a JSON array")
  return parsed.map((s: Record<string, unknown>, i: number) => ({
    title: typeof s.title === "string" ? s.title : "Section",
    content: typeof s.content === "string" ? s.content : "",
    sequence: typeof s.sequence === "number" && s.sequence >= 0 ? s.sequence : (i + 1) * 10,
  }))
}

describe("serializeSectionsForTemplate", () => {
  it("writes an ordered array of title, content, sequence only", () => {
    expect(JSON.parse(serializeSectionsForTemplate(sections))).toEqual([
      { title: "Summary", content: "Overview", sequence: 10 },
      { title: "Pricing", content: "Our prices", sequence: 20 },
    ])
  })

  it("round-trips through the apply reader", () => {
    expect(applyLikeReducer(serializeSectionsForTemplate(sections))).toEqual([
      { title: "Summary", content: "Overview", sequence: 10 },
      { title: "Pricing", content: "Our prices", sequence: 20 },
    ])
  })

  it("serialises no sections as an empty array", () => {
    expect(serializeSectionsForTemplate([])).toBe("[]")
  })
})

describe("parseSectionTemplateInput", () => {
  it("builds the params with trimmed fields and an optional country pack", () => {
    const result = parseSectionTemplateInput(
      { name: "  Standard bid ", category: " general ", locale: " en ", countryPackKey: "  " },
      sections,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      name: "Standard bid",
      category: "general",
      locale: "en",
      countryPackKey: null,
      isActive: true,
      metadata: null,
    })
    expect(() => JSON.parse(result.value.sectionsJson)).not.toThrow()
    expect(
      parseSectionTemplateInput({ name: "n", category: "c", locale: "en", countryPackKey: " us " }, sections),
    ).toMatchObject({ ok: true, value: { countryPackKey: "us" } })
  })

  it("rejects a blank name, category or locale and an empty section list", () => {
    const ok = { name: "n", category: "c", locale: "en" }
    expect(parseSectionTemplateInput({ ...ok, name: "  " }, sections)).toEqual({ ok: false, reason: "name" })
    expect(parseSectionTemplateInput({ ...ok, category: "" }, sections)).toEqual({ ok: false, reason: "category" })
    expect(parseSectionTemplateInput({ ...ok, locale: "" }, sections)).toEqual({ ok: false, reason: "locale" })
    expect(parseSectionTemplateInput(ok, [])).toEqual({ ok: false, reason: "sections" })
    expect(parseSectionTemplateInput(null, sections)).toEqual({ ok: false, reason: "name" })
  })
})
