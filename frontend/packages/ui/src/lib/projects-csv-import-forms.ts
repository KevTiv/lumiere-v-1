import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export type ProjectsCsvImportKind = "project" | "task" | "timesheet"

export function projectsCsvImportForm(t: TFunction, kind: ProjectsCsvImportKind): FormConfig {
  const titleKey = `projects.csvImport.${kind}Title` as const
  return {
    id: `projects-csv-import-${kind}`,
    title: t(titleKey),
    description: t("projects.csvImport.description"),
    size: "md",
    icon: "Upload",
    submitLabel: t("projects.csvImport.submit"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "csv-file",
        fields: [
          {
            type: "file",
            id: "csvFile",
            name: "csvFile",
            label: t("projects.csvImport.fileLabel"),
            accept: ".csv,text/csv,text/plain",
            required: true,
            width: "full",
          },
        ],
      },
    ],
  }
}
