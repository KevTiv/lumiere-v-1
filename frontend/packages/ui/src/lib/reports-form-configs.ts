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
          name: "name",
          type: "text",
          label: t("reports.forms.generateReport.fields.name"),
          placeholder: t("reports.forms.generateReport.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "reportType",
          name: "reportType",
          type: "select",
          label: t("reports.forms.generateReport.fields.reportType"),
          required: true,
          width: "1/2",
          defaultValue: "trialBalance",
          options: [
            {
              value: "trialBalance",
              label: t("reports.forms.generateReport.fields.reportTypes.trialBalance"),
            },
            {
              value: "balanceSheet",
              label: t("reports.forms.generateReport.fields.reportTypes.balanceSheet"),
            },
            {
              value: "profitAndLoss",
              label: t("reports.forms.generateReport.fields.reportTypes.profitAndLoss"),
            },
            {
              value: "cashFlow",
              label: t("reports.forms.generateReport.fields.reportTypes.cashFlow"),
            },
            {
              value: "generalLedger",
              label: t("reports.forms.generateReport.fields.reportTypes.generalLedger"),
            },
          ],
        },
        {
          id: "comparisonMode",
          name: "comparisonMode",
          type: "select",
          label: t("reports.forms.generateReport.fields.comparisonMode"),
          width: "1/2",
          defaultValue: "none",
          options: [
            {
              value: "none",
              label: t("reports.forms.generateReport.fields.comparisonOptions.none"),
            },
            {
              value: "previous_period",
              label: t("reports.forms.generateReport.fields.comparisonOptions.previousPeriod"),
            },
            {
              value: "previous_year",
              label: t("reports.forms.generateReport.fields.comparisonOptions.previousYear"),
            },
          ],
        },
        {
          id: "dateFrom",
          name: "dateFrom",
          type: "date",
          label: t("reports.forms.generateReport.fields.dateFrom"),
          required: true,
          width: "1/2",
        },
        {
          id: "dateTo",
          name: "dateTo",
          type: "date",
          label: t("reports.forms.generateReport.fields.dateTo"),
          required: true,
          width: "1/2",
        },
        {
          id: "currencyId",
          name: "currencyId",
          type: "text",
          label: t("reports.forms.generateReport.fields.currencyId"),
          placeholder: t("reports.forms.generateReport.fields.currencyIdPlaceholder"),
          width: "1/2",
          defaultValue: "1",
        },
        {
          id: "hierarchyLevel",
          name: "hierarchyLevel",
          type: "text",
          label: t("reports.forms.generateReport.fields.hierarchyLevel"),
          placeholder: t("reports.forms.generateReport.fields.hierarchyLevelPlaceholder"),
          width: "1/2",
          defaultValue: "2",
        },
        {
          id: "targetMove",
          name: "targetMove",
          type: "select",
          label: t("reports.forms.generateReport.fields.targetMove"),
          width: "1/2",
          options: [
            { value: "posted", label: t("reports.forms.generateReport.fields.options.posted") },
            { value: "all", label: t("reports.forms.generateReport.fields.options.all") },
          ],
        },
        {
          id: "showDebitCredit",
          name: "showDebitCredit",
          type: "checkbox",
          label: t("reports.forms.generateReport.fields.showDebitCredit"),
          width: "1/2",
          defaultValue: true,
        },
        {
          id: "showZeroLines",
          name: "showZeroLines",
          type: "checkbox",
          label: t("reports.forms.generateReport.fields.showZeroLines"),
          width: "1/2",
        },
        {
          id: "showHierarchy",
          name: "showHierarchy",
          type: "checkbox",
          label: t("reports.forms.generateReport.fields.showHierarchy"),
          width: "1/2",
        },
        {
          id: "showPercentage",
          name: "showPercentage",
          type: "checkbox",
          label: t("reports.forms.generateReport.fields.showPercentage"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newReportTemplateForm = (t: TFunction): FormConfig => ({
  id: "new-report-template",
  title: t("reports.forms.reportTemplate.title"),
  description: t("reports.forms.reportTemplate.description"),
  sections: [
    {
      id: "tpl-main",
      title: t("reports.forms.reportTemplate.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("reports.forms.reportTemplate.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "model",
          name: "model",
          type: "text",
          label: t("reports.forms.reportTemplate.fields.model"),
          width: "1/2",
          defaultValue: "account.move",
        },
        {
          id: "reportType",
          name: "reportType",
          type: "select",
          label: t("reports.forms.reportTemplate.fields.reportType"),
          width: "1/2",
          defaultValue: "PDF",
          options: [
            { value: "PDF", label: "PDF" },
            { value: "Excel", label: "Excel" },
            { value: "CSV", label: "CSV" },
            { value: "HTML", label: "HTML" },
          ],
        },
        {
          id: "orientation",
          name: "orientation",
          type: "select",
          label: t("reports.forms.reportTemplate.fields.orientation"),
          width: "1/2",
          defaultValue: "Portrait",
          options: [
            { value: "Portrait", label: t("reports.forms.reportTemplate.fields.orientations.portrait") },
            { value: "Landscape", label: t("reports.forms.reportTemplate.fields.orientations.landscape") },
          ],
        },
        {
          id: "marginTop",
          name: "marginTop",
          type: "text",
          label: t("reports.forms.reportTemplate.fields.marginTop"),
          width: "1/4",
          defaultValue: "10",
        },
        {
          id: "marginBottom",
          name: "marginBottom",
          type: "text",
          label: t("reports.forms.reportTemplate.fields.marginBottom"),
          width: "1/4",
          defaultValue: "10",
        },
        {
          id: "marginLeft",
          name: "marginLeft",
          type: "text",
          label: t("reports.forms.reportTemplate.fields.marginLeft"),
          width: "1/4",
          defaultValue: "7",
        },
        {
          id: "marginRight",
          name: "marginRight",
          type: "text",
          label: t("reports.forms.reportTemplate.fields.marginRight"),
          width: "1/4",
          defaultValue: "7",
        },
        {
          id: "headerLine",
          name: "headerLine",
          type: "checkbox",
          label: t("reports.forms.reportTemplate.fields.headerLine"),
          width: "1/2",
          defaultValue: true,
        },
        {
          id: "footerLine",
          name: "footerLine",
          type: "checkbox",
          label: t("reports.forms.reportTemplate.fields.footerLine"),
          width: "1/2",
          defaultValue: true,
        },
        {
          id: "attachmentUse",
          name: "attachmentUse",
          type: "checkbox",
          label: t("reports.forms.reportTemplate.fields.attachmentUse"),
          width: "1/2",
        },
        {
          id: "multiCompany",
          name: "multiCompany",
          type: "checkbox",
          label: t("reports.forms.reportTemplate.fields.multiCompany"),
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("reports.forms.reportTemplate.fields.isActive"),
          width: "1/2",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const newScheduledReportForm = (t: TFunction): FormConfig => ({
  id: "new-scheduled-report",
  title: t("reports.forms.scheduledReport.title"),
  description: t("reports.forms.scheduledReport.description"),
  sections: [
    {
      id: "sched-main",
      title: t("reports.forms.scheduledReport.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("reports.forms.scheduledReport.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "reportTemplateId",
          name: "reportTemplateId",
          type: "select",
          label: t("reports.forms.scheduledReport.fields.reportTemplateId"),
          required: true,
          width: "full",
          options: [],
        },
        {
          id: "model",
          name: "model",
          type: "text",
          label: t("reports.forms.scheduledReport.fields.model"),
          width: "1/2",
          defaultValue: "account.move",
        },
        {
          id: "frequency",
          name: "frequency",
          type: "select",
          label: t("reports.forms.scheduledReport.fields.frequency"),
          width: "1/2",
          defaultValue: "Weekly",
          options: [
            { value: "Daily", label: t("reports.forms.scheduledReport.frequencies.daily") },
            { value: "Weekly", label: t("reports.forms.scheduledReport.frequencies.weekly") },
            { value: "Monthly", label: t("reports.forms.scheduledReport.frequencies.monthly") },
            { value: "Quarterly", label: t("reports.forms.scheduledReport.frequencies.quarterly") },
          ],
        },
        {
          id: "nextRun",
          name: "nextRun",
          type: "datetime",
          label: t("reports.forms.scheduledReport.fields.nextRun"),
          required: true,
          width: "full",
        },
        {
          id: "attachmentFormat",
          name: "attachmentFormat",
          type: "select",
          label: t("reports.forms.scheduledReport.fields.attachmentFormat"),
          width: "1/2",
          defaultValue: "PDF",
          options: [
            { value: "PDF", label: "PDF" },
            { value: "Excel", label: "Excel" },
            { value: "CSV", label: "CSV" },
          ],
        },
        {
          id: "recipients",
          name: "recipients",
          type: "textarea",
          label: t("reports.forms.scheduledReport.fields.recipients"),
          placeholder: t("reports.forms.scheduledReport.fields.recipientsPlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("reports.forms.scheduledReport.fields.isActive"),
          width: "1/2",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const newAnalyticsMetricForm = (t: TFunction): FormConfig => ({
  id: "new-analytics-metric",
  title: t("reports.forms.analyticsMetric.title"),
  description: t("reports.forms.analyticsMetric.description"),
  sections: [
    {
      id: "metric-main",
      title: t("reports.forms.analyticsMetric.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("reports.forms.analyticsMetric.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "category",
          name: "category",
          type: "text",
          label: t("reports.forms.analyticsMetric.fields.category"),
          width: "1/2",
          defaultValue: "Financial",
        },
        {
          id: "metricType",
          name: "metricType",
          type: "select",
          label: t("reports.forms.analyticsMetric.fields.metricType"),
          width: "1/2",
          defaultValue: "KPI",
          options: [
            { value: "KPI", label: "KPI" },
            { value: "Trend", label: "Trend" },
            { value: "Comparison", label: "Comparison" },
          ],
        },
        {
          id: "model",
          name: "model",
          type: "text",
          label: t("reports.forms.analyticsMetric.fields.model"),
          width: "1/2",
          defaultValue: "account.move",
        },
        {
          id: "field",
          name: "field",
          type: "text",
          label: t("reports.forms.analyticsMetric.fields.field"),
          width: "1/2",
          defaultValue: "amount_total",
        },
        {
          id: "aggregation",
          name: "aggregation",
          type: "select",
          label: t("reports.forms.analyticsMetric.fields.aggregation"),
          width: "1/2",
          defaultValue: "Sum",
          options: [
            { value: "Count", label: "Count" },
            { value: "Sum", label: "Sum" },
            { value: "Average", label: "Average" },
            { value: "Min", label: "Min" },
            { value: "Max", label: "Max" },
          ],
        },
        {
          id: "timePeriod",
          name: "timePeriod",
          type: "text",
          label: t("reports.forms.analyticsMetric.fields.timePeriod"),
          width: "1/2",
          defaultValue: "This Month",
        },
        {
          id: "refreshFrequencyMinutes",
          name: "refreshFrequencyMinutes",
          type: "text",
          label: t("reports.forms.analyticsMetric.fields.refreshFrequencyMinutes"),
          width: "1/2",
          defaultValue: "60",
        },
        {
          id: "targetValue",
          name: "targetValue",
          type: "text",
          label: t("reports.forms.analyticsMetric.fields.targetValue"),
          width: "1/2",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("reports.forms.analyticsMetric.fields.isActive"),
          width: "1/2",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const updateReportTemplateForm = (t: TFunction): FormConfig => ({
  id: "update-report-template",
  title: t("reports.forms.updateReportTemplate.title"),
  description: t("reports.forms.updateReportTemplate.description"),
  sections: [
    {
      id: "upd",
      title: t("reports.forms.updateReportTemplate.sections.layout"),
      fields: [
        {
          id: "orientation",
          name: "orientation",
          type: "select",
          label: t("reports.forms.reportTemplate.fields.orientation"),
          width: "1/2",
          options: [
            { value: "Portrait", label: t("reports.forms.reportTemplate.fields.orientations.portrait") },
            { value: "Landscape", label: t("reports.forms.reportTemplate.fields.orientations.landscape") },
          ],
        },
        {
          id: "paperFormat",
          name: "paperFormat",
          type: "text",
          label: t("reports.forms.updateReportTemplate.fields.paperFormat"),
          placeholder: "A4",
          width: "1/2",
        },
        {
          id: "templateContent",
          name: "templateContent",
          type: "textarea",
          label: t("reports.forms.updateReportTemplate.fields.templateContent"),
          width: "full",
        },
      ],
    },
  ],
})

/** Next run time for `record_report_run` (scheduled report id comes from selection). */
export const recordScheduledRunForm = (t: TFunction): FormConfig => ({
  id: "record-scheduled-run",
  title: t("reports.forms.recordScheduledRun.title"),
  description: t("reports.forms.recordScheduledRun.description"),
  sections: [
    {
      id: "next",
      title: t("reports.forms.recordScheduledRun.sections.next"),
      fields: [
        {
          id: "nextRun",
          name: "nextRun",
          type: "datetime",
          label: t("reports.forms.recordScheduledRun.fields.nextRun"),
          required: true,
          width: "full",
        },
      ],
    },
  ],
})

export const updateMetricValuesForm = (t: TFunction): FormConfig => ({
  id: "update-metric-values",
  title: t("reports.forms.updateMetricValues.title"),
  description: t("reports.forms.updateMetricValues.description"),
  sections: [
    {
      id: "vals",
      title: t("reports.forms.updateMetricValues.sections.values"),
      fields: [
        {
          id: "currentValue",
          name: "currentValue",
          type: "text",
          label: t("reports.forms.updateMetricValues.fields.currentValue"),
          required: true,
          width: "1/2",
        },
        {
          id: "previousValue",
          name: "previousValue",
          type: "text",
          label: t("reports.forms.updateMetricValues.fields.previousValue"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const reportsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-financial-report": newFinancialReportForm(t),
  "new-report-template": newReportTemplateForm(t),
  "new-scheduled-report": newScheduledReportForm(t),
  "new-analytics-metric": newAnalyticsMetricForm(t),
  "update-report-template": updateReportTemplateForm(t),
  "update-metric-values": updateMetricValuesForm(t),
  "record-scheduled-run": recordScheduledRunForm(t),
})
