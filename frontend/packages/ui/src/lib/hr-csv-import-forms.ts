import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export type HrCsvImportKind =
  | "resource"
  | "department"
  | "job_position"
  | "employee"
  | "contract"
  | "leave_type"
  | "leave"
  | "payroll_structure"
  | "salary_rule"
  | "payslip"

export function hrCsvImportForm(t: TFunction, kind: HrCsvImportKind): FormConfig {
  const titleKey = `hr.csvImport.${kind}Title` as const
  return {
    id: `hr-csv-import-${kind}`,
    title: t(titleKey),
    description: t("hr.csvImport.description"),
    size: "md",
    icon: "Upload",
    submitLabel: t("hr.csvImport.submit"),
    cancelLabel: t("common.cancel"),
    sections: [
      {
        id: "csv-file",
        fields: [
          {
            type: "file",
            id: "csvFile",
            name: "csvFile",
            label: t("hr.csvImport.fileLabel"),
            accept: ".csv,text/csv,text/plain",
            required: true,
            width: "full",
          },
        ],
      },
    ],
  }
}
