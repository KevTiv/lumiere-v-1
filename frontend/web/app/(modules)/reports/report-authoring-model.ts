import type { FormConfig, FormField, FormValues } from "@lumiere/ui/lib/form-types"
import type { StoredDashboardDataSources } from "@lumiere/ui/lib/stored-dashboard-resolver"

export type ReportAuthoringKind = "report" | "template" | "schedule" | "dashboard" | "widget"

export function reportAuthoringKind(formId: string): ReportAuthoringKind | null {
  switch (formId) {
    case "new-financial-report": return "report"
    case "new-report-template": return "template"
    case "new-scheduled-report": return "schedule"
    case "new-dashboard": return "dashboard"
    case "new-dashboard-widget": return "widget"
    default: return null
  }
}

export function authoringOptionLabel(config: FormConfig, name: string, value: unknown): string {
  const field = config.sections.flatMap((section) => section.fields).find((item) => item.name === name)
  if (field && "options" in field) {
    return field.options.find((option) => option.value === String(value ?? ""))?.label ?? String(value ?? "")
  }
  return String(value ?? "")
}

export function templatePageGeometry(values: FormValues) {
  const landscape = values.orientation === "Landscape"
  const pageWidth = landscape ? 297 : 210
  const pageHeight = landscape ? 210 : 297
  const margin = (name: string, fallback: number) => {
    const value = Number(values[name])
    return Number.isFinite(value) ? value : fallback
  }
  const top = margin("marginTop", 10)
  const bottom = margin("marginBottom", 10)
  const left = margin("marginLeft", 7)
  const right = margin("marginRight", 7)
  return {
    pageWidth, pageHeight, top, bottom, left, right,
    fits: [top, bottom, left, right].every((value) => value >= 0) && top + bottom < pageHeight && left + right < pageWidth,
  }
}

/** Mirrors the existing schedule mapper: comma/newline recipients, browser-local datetime. */
export function scheduleAuthoringPreview(values: FormValues) {
  const raw = String(values.nextRun ?? "").trim()
  const date = raw ? new Date(raw) : null
  return {
    nextRun: date && Number.isFinite(date.getTime()) ? date : null,
    recipients: String(values.recipients ?? "").split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
    active: values.isActive !== false,
  }
}

/** Preview reads must not mix companies, or treat rows with missing scope as selected-company rows. */
export function scopeWidgetPreviewRows(
  rows: StoredDashboardDataSources[string],
  organizationId: bigint,
  companyId: string,
): StoredDashboardDataSources[string] {
  if (!companyId) return []
  return rows.filter((row) =>
    String(row.organizationId ?? row.organization_id ?? "") === String(organizationId)
    && String(row.companyId ?? row.company_id ?? "") === companyId,
  )
}

/** Existing persisted fields with business labels; no parallel report operation or local write owner. */
export function enhanceWidgetAuthoringForm(config: FormConfig, t: (key: string, options?: { defaultValue: string }) => string): FormConfig {
  const additions: FormField[] = [
    {
      id: "aggregation", name: "aggregation", type: "hidden", defaultValue: "count",
    },
    {
      id: "groupBy", name: "groupBy", type: "select", defaultValue: "state", width: "1/2",
      label: t("reports.authoring.groupBy", { defaultValue: "Group records by" }),
      visibleWhen: { field: "widgetType", equals: "chart" },
      options: [
        { value: "state", label: t("reports.authoring.status", { defaultValue: "Status" }) },
        { value: "currency_id", label: t("reports.authoring.currency", { defaultValue: "Currency" }) },
      ],
    },
    {
      id: "chartType", name: "chartType", type: "select", defaultValue: "bar", width: "1/2",
      label: t("reports.authoring.chartStyle", { defaultValue: "Chart style" }),
      visibleWhen: { field: "widgetType", equals: "chart" },
      options: [
        { value: "bar", label: t("reports.authoring.bar", { defaultValue: "Bar" }) },
        { value: "donut", label: t("reports.authoring.donut", { defaultValue: "Donut" }) },
      ],
    },
  ]
  return {
    ...config,
    sections: config.sections.map((section, index) => ({
      ...section,
      fields: [...section.fields.map((field): FormField => {
        if (field.name === "dataSource") return {
          ...field, type: "select", defaultValue: "account_move", searchable: true,
          options: [
            { value: "account_move", label: t("reports.authoring.journalDocuments", { defaultValue: "Invoices, bills and journal entries" }) },
            { value: "account_payment", label: t("reports.authoring.payments", { defaultValue: "Payments" }) },
          ],
        }
        if (field.name === "widgetType" && field.type === "select") return { ...field, options: field.options.filter((option) => ["kpi", "chart", "table"].includes(option.value)) }
        return field
      }), ...(index === 0 ? additions : [])],
    })),
  }
}
