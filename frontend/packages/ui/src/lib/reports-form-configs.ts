import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newFinancialReportForm = (t: TFunction): FormConfig => ({
  id: "new-financial-report",
  title: t("reports.forms.generateReport.title"),
  description: t("reports.forms.generateReport.description"),
  sections: [
    {
      id: "report-params",
      title: t("reports.forms.generateReport.sections.reportParameters"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("reports.forms.generateReport.fields.name"),
          placeholder: t("reports.forms.generateReport.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "dateFrom",
          type: "date",
          label: t("reports.forms.generateReport.fields.dateFrom"),
          required: true,
          width: "1/2",
        },
        {
          id: "dateTo",
          type: "date",
          label: t("reports.forms.generateReport.fields.dateTo"),
          required: true,
          width: "1/2",
        },
        {
          id: "targetMove",
          type: "select",
          label: t("reports.forms.generateReport.fields.targetMove"),
          width: "1/2",
          options: [
            { value: "posted", label: t("reports.forms.generateReport.fields.options.posted") },
            { value: "all", label: t("reports.forms.generateReport.fields.options.all") },
          ],
        },
        {
          id: "showZeroLines",
          type: "checkbox",
          label: t("reports.forms.generateReport.fields.showZeroLines"),
          width: "1/2",
        },
        {
          id: "showHierarchy",
          type: "checkbox",
          label: t("reports.forms.generateReport.fields.showHierarchy"),
          width: "1/2",
        },
        {
          id: "showPercentage",
          type: "checkbox",
          label: t("reports.forms.generateReport.fields.showPercentage"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const reportsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-financial-report": newFinancialReportForm(t),
})
