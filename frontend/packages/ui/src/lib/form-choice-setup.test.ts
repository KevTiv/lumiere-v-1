import { describe, expect, it } from "vitest"
import type { FormConfig } from "./form-types"
import { withFormChoiceSetup } from "./form-choice-setup"

const config = (options: Array<{ value: string; label: string; disabled?: boolean }>): FormConfig => ({
  id: "quotation", title: "Quotation", sections: [{ id: "pricing", fields: [
    { id: "pricelistId", name: "pricelistId", type: "select", label: "Price list", options },
    { id: "reference", name: "reference", type: "text", defaultValue: "Keep this reference" },
  ] }],
})
const help = { ready: true, message: "Create a price list, then return.", action: { href: "/sales?tab=pricelists", label: "Open price lists" } }

describe("form choice setup recovery", () => {
  it("does not interpret loading, failed or denied choices as missing setup", () => {
    const result = withFormChoiceSetup(config([]), { pricelistId: { ...help, ready: false } })
    expect(result.sections[0].fields[0].recoveryHelp).toBeUndefined()
  })

  it("offers recovery for disabled placeholder options without changing values or reducer fields", () => {
    const input = config([{ value: "", label: "No price lists", disabled: true }])
    const result = withFormChoiceSetup(input, { pricelistId: help })
    expect(result.sections[0].fields[0].recoveryHelp).toEqual({ message: help.message, action: help.action })
    expect(result.sections[0].fields[1]).toBe(input.sections[0].fields[1])
    expect(input.sections[0].fields[0].recoveryHelp).toBeUndefined()
  })

  it("removes obsolete recovery when a usable choice becomes available", () => {
    const prior = withFormChoiceSetup(config([]), { pricelistId: help })
    const field = prior.sections[0].fields[0]
    if (field.type !== "select") throw new Error("Expected select")
    field.options = [{ value: "7", label: "RWF price list" }]
    expect(withFormChoiceSetup(prior, { pricelistId: help }).sections[0].fields[0].recoveryHelp).toBeUndefined()
  })

  it("retains guidance without exposing a setup link to callers without setup permission", () => {
    const result = withFormChoiceSetup(config([]), { pricelistId: { ready: true, message: "Ask an administrator." } })
    expect(result.sections[0].fields[0].recoveryHelp).toEqual({ message: "Ask an administrator.", action: undefined })
  })
})
