import type { BaseField, FormConfig } from "./form-types"

export interface FormChoiceSetup extends NonNullable<BaseField["recoveryHelp"]> {
  /** Loading, failed and denied reads must not be presented as empty data. */
  ready: boolean
}

/** Attach setup guidance only to successfully loaded pickers without a usable choice. */
export function withFormChoiceSetup(
  config: FormConfig,
  setup: Readonly<Record<string, FormChoiceSetup>>,
): FormConfig {
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        const help = setup[field.name]
        if (field.type !== "select" || !help) return field
        const hasChoice = field.options.some((option) => option.value !== "" && !option.disabled)
        return {
          ...field,
          recoveryHelp: help.ready && !hasChoice
            ? { message: help.message, action: help.action }
            : undefined,
        }
      }),
    })),
  }
}
