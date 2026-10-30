import type { ParsedFormField } from "../forms/config/types"

export type InvoiceCustomValue = string | number | boolean | string[]
export type InvoiceCustomField = Pick<ParsedFormField, "fieldId" | "label" | "type" | "validation" | "options" | "visibleWhen">

const supportedTypes = new Set(["Text", "Email", "Tel", "Url", "Textarea", "Number", "Rating", "Slider", "Select", "Radio", "MultiSelect", "UserSelect", "Tags", "Checkbox", "Switch", "Date", "Time", "DateTime"])

export const invoiceCustomFieldMessages = {
  unsupported: "This configured field is not supported by invoice entry.",
  required: "Complete this required field.",
  finiteNumber: "Enter a finite number.",
  numberLimits: "Enter a number within the configured limits.",
  boolean: "Choose a yes or no value.",
  distinctText: "Choose distinct text values.",
  text: "Enter a text value.",
  option: "Choose an available configured option.",
  textLength: "Use the configured text length.",
  email: "Enter a valid email address.",
  format: "Use the configured format.",
  invalidPattern: "The configured validation pattern is invalid.",
}

export function invoiceCustomFieldSupported(field: InvoiceCustomField): boolean {
  return supportedTypes.has(field.type) && !field.visibleWhen
    && (!field.validation.pattern || field.validation.pattern === "email")
    && (field.type !== "UserSelect" || field.options.length > 0)
}

/** The canonical create owner revalidates these values before any business write. */
export function invoiceCustomFieldError(field: InvoiceCustomField, value: InvoiceCustomValue | undefined): keyof typeof invoiceCustomFieldMessages | undefined {
  if (!invoiceCustomFieldSupported(field)) return "unsupported"
  if (value === undefined || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0)) {
    return field.validation.required ? "required" : undefined
  }
  if (["Number", "Rating", "Slider"].includes(field.type)) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "finiteNumber"
    if ((field.validation.min != null && value < field.validation.min) || (field.validation.max != null && value > field.validation.max)) return "numberLimits"
  } else if (["Checkbox", "Switch"].includes(field.type)) {
    if (typeof value !== "boolean") return "boolean"
  } else if (["MultiSelect", "Tags"].includes(field.type)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) return "distinctText"
  } else if (typeof value !== "string") return "text"

  if (["Select", "Radio", "UserSelect", "MultiSelect"].includes(field.type)) {
    const selected = Array.isArray(value) ? value : [value]
    if (selected.some((item) => !field.options.some((option) => option.value === item && !option.disabled))) return "option"
  }
  if (typeof value === "string") {
    const length = Array.from(value).length
    if ((field.validation.minLength != null && length < field.validation.minLength) || (field.validation.maxLength != null && length > field.validation.maxLength)) return "textLength"
    if ((field.type === "Email" || field.validation.pattern === "email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email"
  }
  return undefined
}
