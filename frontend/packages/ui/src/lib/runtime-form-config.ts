import type { FormConfig, FormField, FormSection, FieldWidth } from "./form-types"
import type { MergedFormConfiguration, ParsedFormField, FieldType as StdbFieldType } from "../forms/config/types"
import { isCustomField } from "../forms/config/types"

/** Normalize field keys for cross-config matching (camelCase ↔ snake_case). */
export function normalizeFormFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

const STATIC_FIELD_ALIASES: Record<string, readonly string[]> = {
  contactname: ["firstname", "first_name", "name"],
  emailfrom: ["email"],
  partnername: ["company", "companyname", "company_name"],
  expectedrevenue: ["expected_revenue", "revenue"],
  datedeadline: ["date_deadline", "deadline"],
}

function stdbFieldKeys(field: ParsedFormField): string[] {
  return [field.fieldId, field.name].map(normalizeFormFieldKey)
}

function staticFieldKeys(field: { id: string; name: string }): string[] {
  const base = [field.id, field.name].map(normalizeFormFieldKey)
  const aliases = STATIC_FIELD_ALIASES[field.name] ?? STATIC_FIELD_ALIASES[normalizeFormFieldKey(field.name)] ?? []
  return [...base, ...aliases.map(normalizeFormFieldKey)]
}

function findMatchingStdbField(
  staticField: { id: string; name: string },
  stdbFields: ParsedFormField[],
): ParsedFormField | undefined {
  const keys = new Set(staticFieldKeys(staticField))
  return stdbFields.find((f) => stdbFieldKeys(f).some((k) => keys.has(k)))
}

function stdbWidthToModular(width: ParsedFormField["width"]): FieldWidth | undefined {
  switch (width) {
    case "Full":
      return "full"
    case "Half":
      return "1/2"
    case "Third":
      return "1/3"
    case "TwoThirds":
      return "2/3"
    case "Quarter":
      return "1/4"
    default:
      return undefined
  }
}

function stdbTypeToModular(type: StdbFieldType): FormField["type"] {
  switch (type) {
    case "Text":
      return "text"
    case "Email":
      return "email"
    case "Password":
      return "password"
    case "Tel":
      return "tel"
    case "Url":
      return "url"
    case "Textarea":
      return "textarea"
    case "Number":
    case "Rating":
    case "Slider":
      return "number"
    case "Select":
    case "MultiSelect":
    case "UserSelect":
      return "select"
    case "Checkbox":
      return "checkbox"
    case "Switch":
      return "switch"
    case "Radio":
      return "radio"
    case "Date":
      return "date"
    case "Time":
      return "time"
    case "DateTime":
      return "datetime"
    case "File":
      return "file"
    case "Hidden":
      return "hidden"
    default:
      return "text"
  }
}

/** Convert a STDB parsed field into a ModularForm {@link FormField}. */
export function parsedFieldToModularField(field: ParsedFormField): FormField {
  const base = {
    id: field.fieldId,
    name: isCustomField(field.fieldId) ? field.fieldId : field.name || field.fieldId,
    label: field.label,
    placeholder: field.placeholder,
    description: field.description,
    required: field.validation.required,
    width: stdbWidthToModular(field.width),
    defaultValue: field.defaultValue,
    validation: {
      min: field.validation.min,
      max: field.validation.max,
      minLength: field.validation.minLength,
      maxLength: field.validation.maxLength,
      pattern: field.validation.pattern,
    },
  }

  const modularType = stdbTypeToModular(field.type)
  if (modularType === "select" || modularType === "radio") {
    return {
      ...base,
      type: modularType,
      options: field.options.map((o) => ({ value: o.value, label: o.label, disabled: false })),
      defaultValue: typeof field.defaultValue === "string" ? field.defaultValue : undefined,
    }
  }
  if (modularType === "checkbox" || modularType === "switch") {
    return {
      ...base,
      type: modularType,
      defaultValue: Boolean(field.defaultValue),
    }
  }
  if (modularType === "number") {
    return {
      ...base,
      type: "number",
      defaultValue:
        typeof field.defaultValue === "number"
          ? field.defaultValue
          : field.defaultValue != null && field.defaultValue !== ""
            ? Number(field.defaultValue)
            : undefined,
    }
  }
  return {
    ...base,
    type: modularType,
    defaultValue:
      field.defaultValue != null && field.defaultValue !== ""
        ? String(field.defaultValue)
        : undefined,
  } as FormField
}

function applyStdbOverrides(staticField: FormField, stdbField: ParsedFormField): FormField {
  const merged: FormField = {
    ...staticField,
    label: stdbField.label || staticField.label,
    placeholder: stdbField.placeholder || staticField.placeholder,
    description: stdbField.description || staticField.description,
    required: stdbField.validation.required || staticField.required,
    width: stdbWidthToModular(stdbField.width) ?? staticField.width,
  }
  if (stdbField.defaultValue !== undefined && staticField.defaultValue === undefined) {
    return { ...merged, defaultValue: stdbField.defaultValue } as FormField
  }
  return merged
}

/**
 * Merge a static module {@link FormConfig} with a STDB {@link MergedFormConfiguration}.
 * Static fields remain the source of reducer field names; STDB drives visibility, labels, and custom fields.
 */
export function mergeRuntimeFormConfig(
  staticConfig: FormConfig,
  runtime: MergedFormConfiguration | null,
): { config: FormConfig; customFieldIds: string[] } {
  if (!runtime) {
    return { config: staticConfig, customFieldIds: [] }
  }

  const enabledStdb = new Map<string, ParsedFormField>()
  for (const f of runtime.fields) {
    for (const k of stdbFieldKeys(f)) {
      enabledStdb.set(k, f)
    }
  }

  const matchedStdbIds = new Set<string>()
  const sections: FormSection[] = staticConfig.sections.map((section) => ({
    ...section,
    fields: section.fields
      .map((field) => {
        const match = findMatchingStdbField(field, runtime.fields)
        if (match) {
          matchedStdbIds.add(match.fieldId)
          const enabled = enabledStdb.has(normalizeFormFieldKey(match.fieldId))
            || enabledStdb.has(normalizeFormFieldKey(match.name))
          if (!enabled) return null
          return applyStdbOverrides(field, match)
        }
        // No STDB counterpart — keep static field (reducer contract).
        return field
      })
      .filter((f): f is FormField => f != null),
  }))

  const extraFields = runtime.fields
    .filter((f) => !matchedStdbIds.has(f.fieldId))
    .filter((f) => f.isEnabled)
    .sort((a, b) => a.order - b.order)
    .map(parsedFieldToModularField)

  if (extraFields.length > 0) {
    sections.push({
      id: "runtime-extra-fields",
      title: "Additional fields",
      fields: extraFields,
    })
  }

  const customFieldIds = runtime.fields
    .filter((f) => isCustomField(f.fieldId))
    .map((f) => f.fieldId)

  return {
    config: { ...staticConfig, sections },
    customFieldIds,
  }
}
