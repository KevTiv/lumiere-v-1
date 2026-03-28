import type { FormConfig, SelectField } from "./form-types"

/**
 * Replace `select` field options for the field with the given `name` (react-hook / modular form name).
 * Used to inject live lookup options from `/api/query/*` without duplicating entire form configs.
 */
export function mergeSelectOptionsByFieldName(
  config: FormConfig,
  fieldName: string,
  options: Array<{ value: string; label: string; disabled?: boolean }>,
): FormConfig {
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.name === fieldName && field.type === "select") {
          return { ...field, options } as SelectField
        }
        return field
      }),
    })),
  }
}

/**
 * Apply multiple select option sets in one pass (order of keys does not matter).
 */
export function mergeSelectOptionsForFields(
  config: FormConfig,
  fieldOptions: Record<string, Array<{ value: string; label: string; disabled?: boolean }>>,
): FormConfig {
  return Object.entries(fieldOptions).reduce(
    (acc, [fieldName, options]) => mergeSelectOptionsByFieldName(acc, fieldName, options),
    config,
  )
}
