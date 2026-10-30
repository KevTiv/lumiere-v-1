import type {
  AiFormFieldSchema,
  AiFormSuggestion,
  AiFormSuggestionSource,
  AiFormSuggestResponse,
} from "./ai-forms"

function invalid(): never {
  throw new Error("AI form suggestions could not be verified.")
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== "string") invalid()
  return value
}

function sources(value: unknown): AiFormSuggestionSource[] {
  if (!Array.isArray(value)) invalid()
  return value.map((item) => {
    const source = record(item)
    if (typeof source.type !== "string" || !source.type.trim()) invalid()
    return {
      type: source.type,
      ...(source.label == null ? {} : { label: optionalString(source.label) }),
      ...(source.value == null ? {} : { value: optionalString(source.value) }),
      ...(source.field == null ? {} : { field: optionalString(source.field) }),
    }
  })
}

function fieldValue(field: AiFormFieldSchema, value: unknown): void {
  switch (field.type) {
    case "checkbox":
    case "switch":
      if (typeof value !== "boolean") invalid()
      return
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) invalid()
      return
    case "select":
    case "radio":
      if (typeof value !== "string") invalid()
      if (field.options && !field.options.some((option) => !option.disabled && option.value === value)) invalid()
      return
    case "text":
    case "email":
    case "tel":
    case "url":
    case "textarea":
    case "date":
    case "time":
    case "datetime":
      if (typeof value !== "string") invalid()
      return
    default:
      // Hidden context, files and other non-editable values are not model proposals.
      invalid()
  }
}

/** Decode advisory values against the request schema without changing or submitting them. */
export function decodeAiFormSuggestions(
  value: unknown,
  fields: readonly AiFormFieldSchema[],
): AiFormSuggestResponse {
  const response = record(value)
  const byName = new Map(fields.map((field) => [field.name, field]))
  if (byName.size !== fields.length) invalid()
  const suggestions: Record<string, AiFormSuggestion> = {}
  for (const [name, raw] of Object.entries(record(response.suggestions))) {
    if (name === "__proto__" || name === "constructor" || name === "prototype") invalid()
    const field = byName.get(name)
    if (!field) invalid()
    const suggestion = record(raw)
    fieldValue(field, suggestion.value)
    if (typeof suggestion.confidence !== "number" || !Number.isFinite(suggestion.confidence)
      || suggestion.confidence < 0 || suggestion.confidence > 1) invalid()
    suggestions[name] = {
      value: suggestion.value,
      confidence: suggestion.confidence,
      ...(suggestion.note == null ? {} : { note: optionalString(suggestion.note) }),
      ...(suggestion.sources === undefined ? {} : { sources: sources(suggestion.sources) }),
    }
  }
  if (!Array.isArray(response.validation_notes)) invalid()
  const validation_notes = response.validation_notes.map((item): AiFormSuggestResponse["validation_notes"][number] => {
    const note = record(item)
    if (typeof note.message !== "string" || !note.message.trim()) invalid()
    const severity = optionalString(note.severity)
    if (severity !== undefined && severity !== "info" && severity !== "warning" && severity !== "error") invalid()
    return {
      message: note.message,
      ...(note.field == null ? {} : { field: optionalString(note.field) }),
      ...(severity === undefined ? {} : { severity }),
    }
  })
  return { suggestions, validation_notes, sources: sources(response.sources) }
}
