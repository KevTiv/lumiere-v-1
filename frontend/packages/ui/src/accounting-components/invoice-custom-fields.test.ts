import { describe, expect, it } from "vitest"
import { invoiceCustomFieldError, invoiceCustomFieldSupported, type InvoiceCustomField } from "./invoice-custom-fields"

const field = (overrides: Partial<InvoiceCustomField> = {}): InvoiceCustomField => ({
  fieldId: "custom:reference", label: "Reference", type: "Text", options: [], validation: { required: true }, ...overrides,
})

describe("invoice custom field admission", () => {
  it("preserves typed zero, false and exact string identifiers", () => {
    expect(invoiceCustomFieldError(field({ type: "Number" }), 0)).toBeUndefined()
    expect(invoiceCustomFieldError(field({ type: "Checkbox" }), false)).toBeUndefined()
    expect(invoiceCustomFieldError(field(), "18446744073709551615")).toBeUndefined()
    expect(invoiceCustomFieldError(field({ type: "Number" }), "0")).toBeTruthy()
    expect(invoiceCustomFieldError(field({ type: "Number" }), Infinity)).toBeTruthy()
    expect(invoiceCustomFieldError(field({ type: "Checkbox" }), "false")).toBeTruthy()
  })

  it("enforces available options and distinct array values", () => {
    const choice = field({ type: "MultiSelect", options: [{ value: "001", label: "Exact" }, { value: "002", label: "Disabled", disabled: true }] })
    expect(invoiceCustomFieldError(choice, ["001"])).toBeUndefined()
    expect(invoiceCustomFieldError(choice, ["1"])).toBeTruthy()
    expect(invoiceCustomFieldError(choice, ["002"])).toBeTruthy()
    expect(invoiceCustomFieldError(choice, ["001", "001"])).toBeTruthy()
    expect(invoiceCustomFieldError(field({ type: "Select", options: [] }), "001")).toBeTruthy()
  })

  it("validates configured constraints and blocks unsupported fields before create", () => {
    expect(invoiceCustomFieldError(field({ validation: { required: true, pattern: "^INV-[0-9]+$" } }), "wrong")).toBeTruthy()
    expect(invoiceCustomFieldError(field({ validation: { required: true, pattern: "[" } }), "value")).toBeTruthy()
    expect(invoiceCustomFieldError(field({ type: "Number", validation: { required: true, min: 1, max: 2 } }), 3)).toBeTruthy()
    expect(invoiceCustomFieldError(field({ validation: { required: true, minLength: 2 } }), " ")).toBeTruthy()
    for (const type of ["File", "Hidden", "Password", "Custom"] as const) expect(invoiceCustomFieldSupported(field({ type }))).toBe(false)
    expect(invoiceCustomFieldSupported(field({ visibleWhen: { field: "status", equals: "open" } }))).toBe(false)
    expect(invoiceCustomFieldError(field({ validation: { required: false } }), undefined)).toBeUndefined()
    expect(invoiceCustomFieldError(field(), undefined)).toBeTruthy()
  })
})
