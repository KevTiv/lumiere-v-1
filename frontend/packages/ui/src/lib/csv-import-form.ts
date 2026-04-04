import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

/** Single-file CSV import modal (shared across modules). */
export function csvImportForm(
  t: TFunction,
  title: string,
  description = t("common.csvImport.description"),
): FormConfig {
  return {
    id: `csv-import-${title.slice(0, 24).replace(/\s+/g, "-")}`,
    title,
    description,
    size: "md",
    icon: "Upload",
    submitLabel: t("common.csvImport.submit"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "csv-file",
        fields: [
          {
            type: "file",
            id: "csvFile",
            name: "csvFile",
            label: t("common.csvImport.fileLabel"),
            accept: ".csv,text/csv,text/plain",
            required: true,
            width: "full",
          },
        ],
      },
    ],
  }
}
