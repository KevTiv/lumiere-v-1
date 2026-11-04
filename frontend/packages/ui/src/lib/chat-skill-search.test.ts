import { describe, expect, it } from "vitest"
import { matchingChatSkills, slashSkillToken } from "./chat-skill-search"

describe("slash skill search", () => {
  it("finds a token at the caret while retaining the surrounding draft", () => {
    expect(slashSkillToken("Check /reports for May", 10)).toEqual({ start: 6, end: 14, query: "rep" })
    expect(slashSkillToken("Please\n/find", 12)).toEqual({ start: 7, end: 12, query: "find" })
    expect(slashSkillToken("/", 1)).toEqual({ start: 0, end: 1, query: "" })
  })
  it("does not treat URLs, dates, or ERP paths as slash commands", () => {
    for (const text of ["https://example.com/report", "2026/11/02", "/accounting/invoices"]) {
      expect(slashSkillToken(text, text.length)).toBeNull()
    }
  })
  it("searches names and keywords independently of case and supports added skills", () => {
    const skills = [{ id: "reconcile", label: "Reconcile accounts", prompt: "Prepare review", keywords: ["bank match"] }]
    expect(matchingChatSkills(skills, "BANK")).toEqual(skills)
    expect(matchingChatSkills(skills, "bank_match")).toEqual(skills)
    expect(matchingChatSkills(skills, "missing")).toEqual([])
  })
})
