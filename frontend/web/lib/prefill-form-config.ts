import type { FormConfig, FormField } from "@lumiere/ui"

/** Merge row values into form field `defaultValue` so ModularForm picks them up on first render. */
export function withDefaultsFromRow(
  base: FormConfig,
  row: Record<string, unknown>,
): FormConfig {
  return {
    ...base,
    sections: base.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        const f = field as FormField & { defaultValue?: unknown }
        const raw = row[f.name]
        if (raw === undefined || raw === null) return f
        return { ...f, defaultValue: raw }
      }),
    })),
  }
}
