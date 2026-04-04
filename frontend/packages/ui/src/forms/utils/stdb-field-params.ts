import type {
  FieldOption as StdbFieldOption,
  FieldValidation as StdbFieldValidation,
} from "@lumiere/stdb"

/** Maps UI/registry field options to the exact shape SpacetimeDB expects. */
export function formOptionsToStdb(
  options: ReadonlyArray<{ value: string; label: string; color?: string; icon?: string }> | undefined,
): StdbFieldOption[] {
  return (options ?? []).map(
    (o) =>
      ({
        value: o.value,
        label: o.label,
        color: o.color,
        icon: o.icon,
      }) as StdbFieldOption,
  )
}

export function formValidationToStdb(v: {
  required?: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: string
  message?: string
} | undefined): StdbFieldValidation {
  const x = v ?? { required: false }
  return {
    required: x.required ?? false,
    minLength: x.minLength,
    maxLength: x.maxLength,
    min: x.min,
    max: x.max,
    pattern: x.pattern,
    message: x.message,
  } as StdbFieldValidation
}
