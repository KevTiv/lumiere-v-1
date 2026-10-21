import type { TFunction } from "i18next"
import type { FormConfig, FormField, FormValues } from "@lumiere/ui/lib/form-types"

const ACCOUNTING_MODEL = "account.move"
const MEASURES = ["amount_total", "amount_residual", "amount_untaxed", "amount_tax"] as const
const AGGREGATIONS = ["Count", "Sum", "Average", "Min", "Max"] as const
const PERIODS = ["Today", "This Week", "This Month", "This Quarter", "This Year"] as const

/** The metric operation stores a definition; it does not compute its value. */
export function enhanceMetricForm(config: FormConfig, t: TFunction): FormConfig {
  const options = (items: ReadonlyArray<readonly [string, string, string]>) => items.map(([value, key, label]) => ({ value, label: t(key, { defaultValue: label }) }))
  const measures = options([
    ["amount_total", "reports.authoring.metric.documentTotal", "Document total"],
    ["amount_residual", "reports.authoring.metric.outstandingAmount", "Outstanding amount"],
    ["amount_untaxed", "reports.authoring.metric.untaxedAmount", "Untaxed amount"],
    ["amount_tax", "reports.authoring.metric.taxAmount", "Tax amount"],
  ])
  const periods = options([
    ["Today", "reports.authoring.metric.today", "Today"],
    ["This Week", "reports.authoring.metric.thisWeek", "This week"],
    ["This Month", "reports.authoring.metric.thisMonth", "This month"],
    ["This Quarter", "reports.authoring.metric.thisQuarter", "This quarter"],
    ["This Year", "reports.authoring.metric.thisYear", "This year"],
  ])
  const calculations = options([
    ["Count", "reports.authoring.metric.count", "Document count"],
    ["Sum", "reports.authoring.metric.sum", "Total"],
    ["Average", "reports.authoring.metric.average", "Average"],
    ["Min", "reports.authoring.metric.minimum", "Lowest value"],
    ["Max", "reports.authoring.metric.maximum", "Highest value"],
  ])
  const enhanceField = (field: FormField): FormField => {
    if (field.name === "model") return {
      ...field, type: "select", defaultValue: ACCOUNTING_MODEL,
      label: t("reports.authoring.metric.source", { defaultValue: "Source documents" }),
      description: t("reports.authoring.metric.sourceHint", { defaultValue: "Accounting documents include invoices, bills, and journal entries. No document-type filter is applied." }),
      options: [{ value: ACCOUNTING_MODEL, label: t("reports.authoring.metric.accountingDocuments", { defaultValue: "Accounting documents" }) }],
    }
    if (field.name === "field") return {
      ...field, type: "select", defaultValue: "amount_total",
      label: t("reports.authoring.metric.measure", { defaultValue: "Measure" }),
      description: t("reports.authoring.metric.measureHint", { defaultValue: "Document count counts records and does not use the selected amount." }),
      options: measures,
    }
    if (field.name === "aggregation") return { ...field, type: "select", defaultValue: "Sum", options: calculations }
    if (field.name === "timePeriod") return { ...field, type: "select", defaultValue: "This Month", options: periods }
    if (field.name === "refreshFrequencyMinutes") return {
      ...field, type: "number", defaultValue: 60, min: 1, max: 0xffffffff, step: 1,
      label: t("reports.authoring.metric.requestedRefresh", { defaultValue: "Requested refresh interval (minutes)" }),
      description: t("reports.authoring.metric.refreshHint", { defaultValue: "This interval is saved in the definition. It does not start a calculation job." }),
    }
    if (field.name === "targetValue") return { ...field, type: "number", defaultValue: undefined, step: 0.01 }
    return field
  }
  return {
    ...config, size: "xl",
    submitLabel: t("reports.authoring.metric.saveDefinition", { defaultValue: "Save metric definition" }),
    description: t("reports.authoring.metric.description", { defaultValue: "Choose a measure and inspect its definition. Calculated values are supplied separately." }),
    sections: config.sections.map((section) => ({ ...section, fields: section.fields.map(enhanceField) })),
  }
}

export interface MetricDefinitionPreview {
  name: string
  metricType: "KPI" | "Trend" | "Comparison" | null
  source: typeof ACCOUNTING_MODEL | null
  measure: typeof MEASURES[number] | null
  aggregation: typeof AGGREGATIONS[number] | null
  period: typeof PERIODS[number] | null
  target: number | null
  active: boolean
  currentValue: null
  previousValue: null
}

/** Preview the local definition without reading or aggregating financial records. */
export function metricDefinitionPreview(values: FormValues): MetricDefinitionPreview {
  const targetText = String(values.targetValue ?? "").trim()
  const targetNumber = targetText === "" ? NaN : Number(targetText)
  const type = String(values.metricType ?? "KPI")
  const measure = String(values.field ?? "amount_total")
  const aggregation = String(values.aggregation ?? "Sum")
  const period = String(values.timePeriod ?? "This Month")
  return {
    name: String(values.name ?? "").trim(),
    metricType: type === "KPI" || type === "Trend" || type === "Comparison" ? type : null,
    source: String(values.model ?? ACCOUNTING_MODEL) === ACCOUNTING_MODEL ? ACCOUNTING_MODEL : null,
    measure: MEASURES.find((candidate) => candidate === measure) ?? null,
    aggregation: AGGREGATIONS.find((candidate) => candidate === aggregation) ?? null,
    period: PERIODS.find((candidate) => candidate === period) ?? null,
    target: Number.isFinite(targetNumber) ? targetNumber : null,
    active: values.isActive === undefined ? true : values.isActive === true,
    currentValue: null,
    previousValue: null,
  }
}

/** Resolve choices from the same configuration that supplies the editor. */
export function metricChoiceLabel(config: FormConfig, fieldName: string, value: unknown): string | null {
  const field = config.sections.flatMap((section) => section.fields).find((candidate) => candidate.name === fieldName)
  if (field?.type !== "select") return null
  const option = field.options.find((candidate) => candidate.value === String(value ?? "") && !candidate.disabled)
  return option?.label ?? null
}
