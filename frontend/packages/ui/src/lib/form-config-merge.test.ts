import { describe, expect, it } from "vitest"
import { mergeSelectOptionsForFields } from "./form-config-merge"
import type { FormConfig } from "./form-types"

describe("live form choices", () => {
  it("updates select and multiselect options without mutating the source", () => {
    const config: FormConfig = { id: "choices", title: "Choices", sections: [{ id: "main", fields: [
      { id: "project", name: "project", type: "select", options: [] },
      { id: "taxes", name: "taxes", type: "multiselect", options: [] },
      { id: "note", name: "note", type: "text" },
    ] }] }
    const options = [{ value: "7", label: "Current choice", disabled: true }]
    const result = mergeSelectOptionsForFields(config, { project: options, taxes: options, note: options })
    for (const field of result.sections[0]!.fields.slice(0, 2)) {
      expect("options" in field && field.options).toEqual(options)
    }
    expect(result.sections[0]!.fields[2]).toBe(config.sections[0]!.fields[2])
    expect(config.sections[0]!.fields.slice(0, 2).every((field) => "options" in field && field.options.length === 0)).toBe(true)
  })
})
