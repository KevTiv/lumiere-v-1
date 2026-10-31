import { describe, expect, it } from "vitest"
import { configuredCustomFieldCreateIssue, configuredCustomFieldCreateIssues, resolvedCustomFieldCreateIssues } from "./custom-field-create-admission"

describe("configured atomic creation admission", () => {
  it("permits supported scalar and array editors without converting zero or false into missing fields", () => {
    for (const type of ["Text", "Email", "Number", "Rating", "Slider", "Checkbox", "Switch", "Date", "Time", "DateTime", "Tags"]) {
      expect(configuredCustomFieldCreateIssue({ type, validation: { required: true } })).toBeUndefined()
    }
    for (const type of ["Select", "Radio", "MultiSelect", "UserSelect"]) {
      expect(configuredCustomFieldCreateIssue({ type, validation: { required: true }, options: [{ value: "001" }] })).toBeUndefined()
    }
  })

  it("rejects unsupported types and conditional visibility even on optional fields", () => {
    for (const type of ["File", "Custom", "Password", "Hidden", "FutureType"]) {
      expect(configuredCustomFieldCreateIssue({ type, validation: { required: false } })).toBe("unsupportedType")
    }
    expect(configuredCustomFieldCreateIssue({ type: "Text", visibleWhen: { field: "state", equals: "ready" } })).toBe("conditionalVisibility")
  })

  it("admits only the native email pattern and stored usable required choices", () => {
    expect(configuredCustomFieldCreateIssue({ type: "Text", validation: { pattern: "email" } })).toBeUndefined()
    expect(configuredCustomFieldCreateIssue({ type: "Text", validation: { pattern: "^INV-[0-9]+$" } })).toBe("validationPattern")
    expect(configuredCustomFieldCreateIssue({ type: "UserSelect", options: [] })).toBe("unavailableChoices")
    expect(configuredCustomFieldCreateIssue({ type: "Select", validation: { required: true }, options: [{ value: "disabled", disabled: true }] })).toBe("unavailableChoices")
    expect(configuredCustomFieldCreateIssue({ type: "Select", validation: { required: false }, options: [] })).toBeUndefined()
  })

  it("names duplicate definitions and ignores disabled definitions and ordinary fields", () => {
    const field = { fieldId: "custom:code", label: "Reference code", type: "Text" }
    expect(configuredCustomFieldCreateIssues([field, field])).toEqual([{ fieldId: field.fieldId, label: field.label, reason: "ambiguousDefinition" }])
    expect(configuredCustomFieldCreateIssues([{ ...field, type: "File", isEnabled: false }, { ...field, fieldId: "name", type: "File" }])).toEqual([])
  })

  it("checks caller-transformed custom controls without treating regular custom widgets as EAV fields", () => {
    expect(resolvedCustomFieldCreateIssues({ id: "new-contact", title: "Contact", sections: [{ id: "fields", fields: [
      { id: "custom:attachment", name: "custom:attachment", label: "Attachment", type: "file" },
      { id: "amount", name: "amount", type: "hidden" },
      { id: "custom:count", name: "custom:count", type: "number", defaultValue: 0 },
      { id: "custom:checked", name: "custom:checked", type: "checkbox", defaultValue: false },
    ] }] })).toEqual([{ fieldId: "custom:attachment", label: "Attachment", reason: "unsupportedType" }])
  })
})
