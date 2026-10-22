import type { TFunction } from "i18next"
import { updateReportTemplateForm } from "@lumiere/ui/lib/reports-form-configs"
import type { FormConfig } from "@lumiere/ui/lib/form-types"
import type { ReportTemplateEditValues } from "@lumiere/query-hooks/hooks/report-template-effect"
import { TemplateLayoutEditor } from "./template-layout-editor"

export function templateEditorForm(
  t: TFunction,
  values: ReportTemplateEditValues,
  disabled = false,
): FormConfig {
  const config = updateReportTemplateForm(t)
  return {
    ...config,
    size: "xl",
    submitLabel: t("reports.layout.save", {
      defaultValue: "Save template layout",
    }),
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((source) => {
        const field = { ...source, disabled: disabled || source.disabled }
        if (field.name === "templateContent")
          return {
            ...field,
            type: "custom" as const,
            component: TemplateLayoutEditor,
            defaultValue: values.templateContent ?? "",
          }
        if (field.name === "orientation" && field.type === "select")
          return {
            ...field,
            defaultValue: values.orientation,
            options: field.options.some((option) => option.value === values.orientation)
              ? field.options
              : [
                  ...field.options,
                  {
                    value: values.orientation,
                    label: t("reports.layout.existingOrientation", {
                      defaultValue: "Existing orientation: {{value}}",
                      value: values.orientation,
                    }),
                    disabled: true,
                  },
                ],
          }
        if (field.name === "paperFormat" && field.type === "text")
          return { ...field, defaultValue: values.paperFormat ?? "" }
        return field
      }),
    })),
  }
}
