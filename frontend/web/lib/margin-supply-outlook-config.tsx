import type {
  MarginSupplyScenario,
  MarginSupplyScenarioProvenance,
  MoneyAmount,
  ReportPreview,
} from "@lumiere/erp-shared/report-schemas"
import type { DashboardConfig } from "@lumiere/ui"

import { MarginSupplySuggestionReview } from "./margin-supply-suggestion-review"

export type MarginSupplyScenarioFieldKey = keyof Omit<MarginSupplyScenario, "provenance">
export type MarginSupplyScenarioDraft = Record<MarginSupplyScenarioFieldKey, string>

export interface MarginSupplyScenarioFieldConfig {
  key: MarginSupplyScenarioFieldKey
  csvHeader: string
  label: string
  min: number
  max: number
  step: number
}

export const MARGIN_SUPPLY_SCENARIO_FIELDS: readonly MarginSupplyScenarioFieldConfig[] = [
  { key: "inputCostChangePct", csvHeader: "input_cost_change_pct", label: "Input cost change (%)", min: -50, max: 500, step: 0.1 },
  { key: "demandChangePct", csvHeader: "demand_change_pct", label: "Demand change (%)", min: -100, max: 500, step: 0.1 },
  { key: "leadTimeChangeDays", csvHeader: "lead_time_change_days", label: "Extra lead time (days)", min: 0, max: 365, step: 1 },
  { key: "targetMarginPct", csvHeader: "target_margin_pct", label: "Target gross margin (%)", min: 0, max: 95, step: 0.1 },
] as const

export const DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT: MarginSupplyScenarioDraft = {
  inputCostChangePct: "10",
  demandChangePct: "0",
  leadTimeChangeDays: "7",
  targetMarginPct: "25",
}

export function marginSupplyScenarioFromDraft(
  draft: MarginSupplyScenarioDraft,
  provenance: MarginSupplyScenarioProvenance = { source: "manual" },
): MarginSupplyScenario {
  const values = Object.fromEntries(MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => {
    const raw = draft[field.key].trim()
    if (!raw) throw new Error(`${field.label} is required.`)
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${field.label} must be a finite number.`)
    if (value < field.min || value > field.max) {
      throw new Error(`${field.label} must be between ${field.min} and ${field.max}.`)
    }
    if (field.step >= 1 && !Number.isInteger(value)) {
      throw new Error(`${field.label} must be a whole number.`)
    }
    return [field.key, value]
  })) as Omit<MarginSupplyScenario, "provenance">

  return {
    ...values,
    provenance,
  }
}

type MarginSupplyPreview = Extract<ReportPreview, { reportKey: "margin_supply_outlook_v1" }>

function formatMoney(amount: MoneyAmount): string {
  return (amount.minorUnits / 10 ** amount.scale).toLocaleString(undefined, {
    minimumFractionDigits: amount.scale,
    maximumFractionDigits: amount.scale,
  })
}

function formatPercent(value?: number): string {
  return value == null ? "n/a" : `${value.toFixed(1)}%`
}

function formatScenarioSource(provenance?: MarginSupplyScenarioProvenance): string {
  if (!provenance || provenance.source === "manual") return "Manual entry"
  return `${provenance.fileName ?? "Controlled CSV"}${provenance.rowNumber ? ` · row ${provenance.rowNumber}` : ""}`
}

function ManagementFollowUp({ data }: { data: unknown }) {
  const recommendations = data as string[]
  if (recommendations.length === 0) {
    return <p className="text-sm text-muted-foreground">No follow-up generated for this scenario.</p>
  }
  return (
    <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
      {recommendations.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}

export function createMarginSupplyDashboard(preview: MarginSupplyPreview): DashboardConfig {
  const report = preview.report
  return {
    id: "margin-supply-outlook",
    title: "Margin & Supply Outlook",
    description: `Scenario decision support · ${preview.scope.dateFrom} to ${preview.scope.dateToExclusive}`,
    sections: [
      {
        id: "financial-impact",
        title: "Financial impact",
        widgets: [
          { id: "baseline-gross-profit", type: "kpi", title: "Baseline gross profit", width: "1/2", data: { label: "Baseline gross profit", value: formatMoney(report.baselineGrossProfit), trend: "neutral" } },
          { id: "stressed-gross-profit", type: "kpi", title: "Stressed gross profit", width: "1/2", data: { label: "Stressed gross profit", value: formatMoney(report.stressedGrossProfit), trend: report.profitAtRisk.minorUnits > 0 ? "down" : "neutral" } },
          { id: "profit-at-risk", type: "kpi", title: "Gross profit at risk", width: "1/2", data: { label: "Gross profit at risk", value: formatMoney(report.profitAtRisk), trend: report.profitAtRisk.minorUnits > 0 ? "down" : "neutral" } },
          { id: "stock-shortfall", type: "kpi", title: "Projected stock shortfall", width: "1/2", data: { label: "Projected stock shortfall", value: report.projectedStockShortfall.toLocaleString(undefined, { maximumFractionDigits: 2 }), trend: report.projectedStockShortfall > 0 ? "down" : "neutral" } },
        ],
      },
      {
        id: "assumptions",
        title: "Scenario assumptions",
        widgets: [
          {
            id: "scenario-assumptions",
            type: "stat-cards",
            title: "User-provided scenario",
            width: "full",
            data: {
              stats: [
                { label: "Input cost change", value: `${report.scenario.inputCostChangePct}%` },
                { label: "Demand change", value: `${report.scenario.demandChangePct}%` },
                { label: "Extra lead time", value: `${report.scenario.leadTimeChangeDays} days` },
                { label: "Target gross margin", value: `${report.scenario.targetMarginPct}%` },
                { label: "Scenario source", value: formatScenarioSource(report.scenario.provenance) },
                ...(report.scenario.provenance?.importedAt ? [{ label: "Imported at", value: report.scenario.provenance.importedAt }] : []),
                { label: "Baseline margin", value: formatPercent(report.baselineMarginPct) },
                { label: "Stressed margin", value: formatPercent(report.stressedMarginPct) },
                { label: "Warnings", value: report.warningCount },
                { label: "Critical", value: report.criticalCount },
              ],
            },
          },
        ],
      },
      {
        id: "product-warnings",
        title: "Product warnings",
        widgets: [
          {
            id: "product-exposure",
            type: "table",
            title: "Ranked by severity and profit exposure",
            width: "full",
            data: {
              columns: [
                { key: "product", label: "Product" },
                { key: "severity", label: "Severity" },
                { key: "margin", label: "Margin" },
                { key: "profitAtRisk", label: "Gross profit at risk", align: "right" },
                { key: "cover", label: "Cover", align: "right" },
                { key: "shortfall", label: "Shortfall", align: "right" },
                { key: "targetPrice", label: "Advisory target/unit", align: "right" },
                { key: "warnings", label: "Warnings" },
              ],
              rows: report.lines.map((line) => ({
                product: `${line.productName}${line.sku ? ` · ${line.sku}` : ""}`,
                severity: line.severity,
                margin: `${formatPercent(line.baselineMarginPct)} → ${formatPercent(line.stressedMarginPct)}`,
                profitAtRisk: formatMoney(line.profitAtRisk),
                cover: line.daysOfCover == null ? "n/a" : `${line.daysOfCover.toFixed(1)} days`,
                shortfall: line.projectedStockShortfall.toFixed(2),
                targetPrice: line.targetUnitPrice ? formatMoney(line.targetUnitPrice) : "n/a",
                warnings: line.warningCodes.map((code) => code.replaceAll("_", " ").toLowerCase()).join(", ") || "none",
              })),
            },
          },
        ],
      },
      {
        id: "governed-suggestions",
        title: "Suggestions requiring review",
        widgets: [
          {
            id: "suggestion-review",
            type: "custom",
            title: "Price and replenishment warnings",
            width: "full",
            component: MarginSupplySuggestionReview,
            data: {
              previewIdentity: `${preview.scope.organizationId}:${preview.scope.companyId}:${preview.scope.localDate}:${preview.generatedAt}`,
              suggestions: report.suggestions,
            },
          },
        ],
      },
      {
        id: "management-follow-up",
        title: "Management follow-up",
        widgets: [
          {
            id: "recommendations",
            type: "custom",
            title: "Advisory next steps",
            width: "full",
            component: ManagementFollowUp,
            data: report.recommendations,
          },
        ],
      },
    ],
  }
}

export function marginSupplyXlsxData(preview: MarginSupplyPreview) {
  const report = preview.report
  return {
    title: "Margin & Supply Outlook",
    headers: [
      "Product", "Severity", "Baseline margin %", "Stressed margin %", "Gross profit at risk",
      "Days of cover", "Stock shortfall", "Advisory target unit price", "Warnings",
      "Scenario source", "Input cost change %", "Demand change %", "Extra lead days", "Target gross margin %",
      "Price review status", "Conditional gross-profit uplift", "Replenishment review status", "Calculation evidence and caveats",
    ],
    rows: report.lines.map((line) => {
      const priceSuggestion = report.suggestions.find((suggestion) => (
        suggestion.kind === "price_change" && suggestion.productId === line.productId
      ))
      const replenishmentSuggestion = report.suggestions.find((suggestion) => (
        suggestion.kind === "replenishment_change" && suggestion.productId === line.productId
      ))
      const formulas = [priceSuggestion, replenishmentSuggestion]
        .filter((suggestion) => suggestion != null)
        .map((suggestion) => `${suggestion.provenance.formula}; data quality: ${suggestion.dataQuality.join(", ")}`)
        .join(" | ")
      return [
        line.productName,
        line.severity,
        line.baselineMarginPct ?? "",
        line.stressedMarginPct ?? "",
        line.profitAtRisk.minorUnits / 10 ** line.profitAtRisk.scale,
        line.daysOfCover ?? "",
        line.projectedStockShortfall,
        line.targetUnitPrice ? line.targetUnitPrice.minorUnits / 10 ** line.targetUnitPrice.scale : "",
        line.warningCodes.join(", "),
        formatScenarioSource(report.scenario.provenance),
        report.scenario.inputCostChangePct,
        report.scenario.demandChangePct,
        report.scenario.leadTimeChangeDays,
        report.scenario.targetMarginPct,
        priceSuggestion?.status ?? "",
        priceSuggestion?.kind === "price_change"
          ? priceSuggestion.conditionalGrossProfitUplift.minorUnits / 10 ** priceSuggestion.conditionalGrossProfitUplift.scale
          : "",
        replenishmentSuggestion?.status ?? "",
        formulas,
      ] as (string | number)[][][number]
    }),
  }
}
