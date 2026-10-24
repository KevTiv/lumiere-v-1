import type { FormConfig, FormField, FieldType } from "./form-types"
import { isNumericField, numericFieldBounds } from "./form-types"

export interface AiSafeFormOption {
  value: string
  label: string
  disabled?: boolean
}

export interface AiSafeFormValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

export interface AiSafeFormField {
  name: string
  label?: string
  type: FieldType
  required: boolean
  options?: AiSafeFormOption[]
  validation?: AiSafeFormValidation
}

const AI_SUPPORTED_FIELD_TYPES = new Set<FieldType>([
  "text",
  "email",
  "number",
  "money",
  "percent",
  "quantity",
  "tel",
  "url",
  "textarea",
  "select",
  "checkbox",
  "switch",
  "radio",
  "date",
  "time",
  "datetime",
  "hidden",
])

function optionsForField(field: FormField): AiSafeFormOption[] | undefined {
  if (field.type !== "select" && field.type !== "radio") return undefined
  return field.options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
  }))
}

function validationForField(field: FormField): AiSafeFormValidation | undefined {
  const validation = field.validation
  const bounds = isNumericField(field) ? numericFieldBounds(field) : validation
  if (!validation && !bounds) return undefined

  const safe: AiSafeFormValidation = {}
  if (bounds?.min !== undefined) safe.min = bounds.min
  if (bounds?.max !== undefined) safe.max = bounds.max
  if (!validation) return Object.keys(safe).length > 0 ? safe : undefined
  if (validation.minLength !== undefined) safe.minLength = validation.minLength
  if (validation.maxLength !== undefined) safe.maxLength = validation.maxLength
  if (validation.pattern !== undefined) safe.pattern = validation.pattern

  return Object.keys(safe).length > 0 ? safe : undefined
}

export function serializeAiFormSchema(config: FormConfig): AiSafeFormField[] {
  return config.sections.flatMap((section) =>
    section.fields
      .filter((field) => AI_SUPPORTED_FIELD_TYPES.has(field.type))
      .map((field) => {
        const safeField: AiSafeFormField = {
          name: field.name,
          label: field.label,
          // The gateway coerces "number" suggestions; money/percent/quantity store numbers too.
          type: isNumericField(field) ? "number" : field.type,
          required: field.required === true,
        }
        const options = optionsForField(field)
        if (options) safeField.options = options
        const validation = validationForField(field)
        if (validation) safeField.validation = validation
        return safeField
      }),
  )
}
