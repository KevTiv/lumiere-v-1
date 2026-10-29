import { i18n as uiI18n, useTranslation } from "@lumiere/i18n"
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
  { key: "inputCostChangePct", csvHeader: "input_cost_change_pct", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.mARGINSUPPLYSCENARIOFIELDS.inputCostChangePct.label") }, min: -50, max: 500, step: 0.1 },
  { key: "demandChangePct", csvHeader: "demand_change_pct", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.mARGINSUPPLYSCENARIOFIELDS.demandChangePct.label") }, min: -100, max: 500, step: 0.1 },
  { key: "leadTimeChangeDays", csvHeader: "lead_time_change_days", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.mARGINSUPPLYSCENARIOFIELDS.leadTimeChangeDays.label") }, min: 0, max: 365, step: 1 },
  { key: "targetMarginPct", csvHeader: "target_margin_pct", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.mARGINSUPPLYSCENARIOFIELDS.targetMarginPct.label") }, min: 0, max: 95, step: 0.1 },
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
    if (!raw) throw new Error(uiI18n.t("reports.marginSupply.validation.required", { defaultValue: "{{field}} is required.", field: field.label }))
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(uiI18n.t("reports.marginSupply.validation.finite", { defaultValue: "{{field}} must be a finite number.", field: field.label }))
    if (value < field.min || value > field.max) {
      throw new Error(uiI18n.t("reports.marginSupply.validation.range", { defaultValue: "{{field}} must be between {{min}} and {{max}}.", field: field.label, min: field.min, max: field.max }))
    }
    if (field.step >= 1 && !Number.isInteger(value)) {
      throw new Error(uiI18n.t("reports.marginSupply.validation.whole", { defaultValue: "{{field}} must be a whole number.", field: field.label }))
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
  return value == null ? uiI18n.t("reports.marginSupply.unavailable", { defaultValue: "n/a" }) : `${value.toFixed(1)}%`
}

function formatScenarioSource(provenance?: MarginSupplyScenarioProvenance): string {
  if (!provenance || provenance.source === "manual") return uiI18n.t("reports.marginSupply.source.manual", { defaultValue: "Manual entry" })
  return provenance.rowNumber
    ? uiI18n.t("reports.marginSupply.source.csvRow", { defaultValue: "{{file}} \u00b7 row {{row}}", file: provenance.fileName ?? uiI18n.t("reports.marginSupply.source.csv", { defaultValue: "Controlled CSV" }), row: provenance.rowNumber })
    : provenance.fileName ?? uiI18n.t("reports.marginSupply.source.csv", { defaultValue: "Controlled CSV" })
}

function marginSupplyWarningLabel(code: string): string {
  switch (code) {
    case "MISSING_COST_BASELINE": return uiI18n.t("reports.marginSupply.codes.MISSING_COST_BASELINE", { defaultValue: "missing cost baseline" })
    case "MARGIN_BELOW_TARGET": return uiI18n.t("reports.marginSupply.codes.MARGIN_BELOW_TARGET", { defaultValue: "margin below target" })
    case "PROFIT_AT_RISK": return uiI18n.t("reports.marginSupply.codes.PROFIT_AT_RISK", { defaultValue: "profit at risk" })
    case "STOCKOUT_BEFORE_REPLENISHMENT": return uiI18n.t("reports.marginSupply.codes.STOCKOUT_BEFORE_REPLENISHMENT", { defaultValue: "stockout before replenishment" })
    case "REPLENISHMENT_THRESHOLD_BREACH": return uiI18n.t("reports.marginSupply.codes.REPLENISHMENT_THRESHOLD_BREACH", { defaultValue: "replenishment threshold breach" })
    case "MISSING_LEAD_TIME_BASELINE": return uiI18n.t("reports.marginSupply.codes.MISSING_LEAD_TIME_BASELINE", { defaultValue: "missing lead time baseline" })
    case "STALE_INVENTORY_COUNT": return uiI18n.t("reports.marginSupply.codes.STALE_INVENTORY_COUNT", { defaultValue: "stale inventory count" })
    default: return code
  }
}

function marginSupplySeverityLabel(severity: "ok" | "warning" | "critical"): string {
  switch (severity) {
    case "ok": return uiI18n.t("reports.marginSupply.severity.ok", { defaultValue: "ok" })
    case "warning": return uiI18n.t("reports.marginSupply.severity.warning", { defaultValue: "warning" })
    case "critical": return uiI18n.t("reports.marginSupply.severity.critical", { defaultValue: "critical" })
  }
}

function ManagementFollowUp({ data }: { data: unknown }) {
  useTranslation()
  const recommendations = data as string[]
  if (recommendations.length === 0) {
    return <p className="text-sm text-muted-foreground">{uiI18n.t("reports.marginSupply.noFollowUp", { defaultValue: "No follow-up generated for this scenario." })}</p>
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
    get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.marginSupplyOutlook.title") },
    get description() { return uiI18n.t("reports.marginSupply.description", { defaultValue: "Scenario decision support \u00b7 {{from}} to {{to}}", from: preview.scope.dateFrom, to: preview.scope.dateToExclusive }) },
    sections: [
      {
        id: "financial-impact",
        get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.financialImpact.title") },
        widgets: [
          { id: "baseline-gross-profit", type: "kpi", get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.baselineGrossProfit.title") }, width: "1/2", data: { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.baselineGrossProfit.label") }, value: formatMoney(report.baselineGrossProfit), trend: "neutral" } },
          { id: "stressed-gross-profit", type: "kpi", get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.stressedGrossProfit.title") }, width: "1/2", data: { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.stressedGrossProfit.label") }, value: formatMoney(report.stressedGrossProfit), trend: report.profitAtRisk.minorUnits > 0 ? "down" : "neutral" } },
          { id: "profit-at-risk", type: "kpi", get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.profitAtRisk.title") }, width: "1/2", data: { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.profitAtRisk.label") }, value: formatMoney(report.profitAtRisk), trend: report.profitAtRisk.minorUnits > 0 ? "down" : "neutral" } },
          { id: "stock-shortfall", type: "kpi", get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.stockShortfall.title") }, width: "1/2", data: { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.stockShortfall.label") }, value: report.projectedStockShortfall.toLocaleString(undefined, { maximumFractionDigits: 2 }), trend: report.projectedStockShortfall > 0 ? "down" : "neutral" } },
        ],
      },
      {
        id: "assumptions",
        get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.assumptions.title") },
        widgets: [
          {
            id: "scenario-assumptions",
            type: "stat-cards",
            get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.title") },
            width: "full",
            data: {
              stats: [
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.label") }, value: `${report.scenario.inputCostChangePct}%` },
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labeldemandChange") }, value: `${report.scenario.demandChangePct}%` },
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labelextraLeadTime") }, get value() { return uiI18n.t("reports.marginSupply.days", { defaultValue: "{{count}} days", count: report.scenario.leadTimeChangeDays }) } },
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labeltargetGrossMargin") }, value: `${report.scenario.targetMarginPct}%` },
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labelscenarioSource") }, get value() { return formatScenarioSource(report.scenario.provenance) } },
                ...(report.scenario.provenance?.importedAt ? [{ get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labelimportedAt") }, value: report.scenario.provenance.importedAt }] : []),
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labelbaselineMargin") }, get value() { return formatPercent(report.baselineMarginPct) } },
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labelstressedMargin") }, get value() { return formatPercent(report.stressedMarginPct) } },
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labelwarnings") }, value: report.warningCount },
                { get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.scenarioAssumptions.labelcritical") }, value: report.criticalCount },
              ],
            },
          },
        ],
      },
      {
        id: "product-warnings",
        get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.productWarnings.title") },
        widgets: [
          {
            id: "product-exposure",
            type: "table",
            get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.productExposure.title") },
            width: "full",
            data: {
              columns: [
                { key: "product", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.product.label") } },
                { key: "severity", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.severity.label") } },
                { key: "margin", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.margin.label") } },
                { key: "profitAtRisk", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.profitAtRisk.label") }, align: "right" },
                { key: "cover", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.cover.label") }, align: "right" },
                { key: "shortfall", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.shortfall.label") }, align: "right" },
                { key: "targetPrice", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.targetPrice.label") }, align: "right" },
                { key: "warnings", get label() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.warnings.label") } },
              ],
              rows: report.lines.map((line) => ({
                product: `${line.productName}${line.sku ? ` · ${line.sku}` : ""}`,
                get severity() { return marginSupplySeverityLabel(line.severity) },
                get margin() { return `${formatPercent(line.baselineMarginPct)} → ${formatPercent(line.stressedMarginPct)}` },
                profitAtRisk: formatMoney(line.profitAtRisk),
                get cover() { return line.daysOfCover == null ? uiI18n.t("reports.marginSupply.unavailable", { defaultValue: "n/a" }) : uiI18n.t("reports.marginSupply.coverDays", { defaultValue: "{{value}} days", value: line.daysOfCover.toFixed(1), count: line.daysOfCover }) },
                shortfall: line.projectedStockShortfall.toFixed(2),
                get targetPrice() { return line.targetUnitPrice ? formatMoney(line.targetUnitPrice) : uiI18n.t("reports.marginSupply.unavailable", { defaultValue: "n/a" }) },
                get warnings() { return line.warningCodes.map(marginSupplyWarningLabel).join(", ") || uiI18n.t("reports.marginSupply.noWarnings", { defaultValue: "none" }) },
              })),
            },
          },
        ],
      },
      {
        id: "governed-suggestions",
        get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.governedSuggestions.title") },
        widgets: [
          {
            id: "suggestion-review",
            type: "custom",
            get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.suggestionReview.title") },
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
        get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.managementFollowUp.title") },
        widgets: [
          {
            id: "recommendations",
            type: "custom",
            get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.createMarginSupplyDashboard.recommendations.title") },
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
    get title() { return uiI18n.t("reports.builtIn.marginSupplyOutlookConfig.marginSupplyXlsxData.marginSupplyOutlook.title") },
    headers: [
      uiI18n.t("reports.marginSupply.export.product", { defaultValue: "Product" }),
      uiI18n.t("reports.marginSupply.export.severity", { defaultValue: "Severity" }),
      uiI18n.t("reports.marginSupply.export.baselineMarginPct", { defaultValue: "Baseline margin %" }),
      uiI18n.t("reports.marginSupply.export.stressedMarginPct", { defaultValue: "Stressed margin %" }),
      uiI18n.t("reports.marginSupply.export.grossProfitAtRisk", { defaultValue: "Gross profit at risk" }),
      uiI18n.t("reports.marginSupply.export.daysOfCover", { defaultValue: "Days of cover" }),
      uiI18n.t("reports.marginSupply.export.stockShortfall", { defaultValue: "Stock shortfall" }),
      uiI18n.t("reports.marginSupply.export.advisoryUnitPrice", { defaultValue: "Advisory target unit price" }),
      uiI18n.t("reports.marginSupply.export.warnings", { defaultValue: "Warnings" }),
      uiI18n.t("reports.marginSupply.export.scenarioSource", { defaultValue: "Scenario source" }),
      uiI18n.t("reports.marginSupply.export.inputCostChangePct", { defaultValue: "Input cost change %" }),
      uiI18n.t("reports.marginSupply.export.demandChangePct", { defaultValue: "Demand change %" }),
      uiI18n.t("reports.marginSupply.export.extraLeadDays", { defaultValue: "Extra lead days" }),
      uiI18n.t("reports.marginSupply.export.targetMarginPct", { defaultValue: "Target gross margin %" }),
      uiI18n.t("reports.marginSupply.export.priceReviewStatus", { defaultValue: "Price review status" }),
      uiI18n.t("reports.marginSupply.export.conditionalProfitUplift", { defaultValue: "Conditional gross-profit uplift" }),
      uiI18n.t("reports.marginSupply.export.replenishmentReviewStatus", { defaultValue: "Replenishment review status" }),
      uiI18n.t("reports.marginSupply.export.calculationEvidence", { defaultValue: "Calculation evidence and caveats" }),
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
        .map((suggestion) => uiI18n.t("reports.marginSupply.export.formula", { defaultValue: "{{formula}}; data quality: {{quality}}", formula: suggestion.provenance.formula, quality: suggestion.dataQuality.join(", ") }))
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
