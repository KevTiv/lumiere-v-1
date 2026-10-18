import type {
  MarginSupplyScenario,
  MoneyAmount,
  ReportPreview,
} from "@lumiere/erp-shared/report-schemas"
import type { DashboardConfig } from "@lumiere/ui"

export type MarginSupplyScenarioFieldKey = keyof MarginSupplyScenario
export type MarginSupplyScenarioDraft = Record<MarginSupplyScenarioFieldKey, string>

export interface MarginSupplyScenarioFieldConfig {
  key: MarginSupplyScenarioFieldKey
  label: string
  min: number
  max: number
  step: number
}

export const MARGIN_SUPPLY_SCENARIO_FIELDS: readonly MarginSupplyScenarioFieldConfig[] = [
  { key: "inputCostChangePct", label: "Input cost change (%)", min: -50, max: 500, step: 0.1 },
  { key: "demandChangePct", label: "Demand change (%)", min: -100, max: 500, step: 0.1 },
  { key: "leadTimeChangeDays", label: "Extra lead time (days)", min: 0, max: 365, step: 1 },
  { key: "targetMarginPct", label: "Target gross margin (%)", min: 0, max: 95, step: 0.1 },
] as const

export const DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT: MarginSupplyScenarioDraft = {
  inputCostChangePct: "10",
  demandChangePct: "0",
  leadTimeChangeDays: "7",
  targetMarginPct: "25",
}

export function marginSupplyScenarioFromDraft(
  draft: MarginSupplyScenarioDraft,
): MarginSupplyScenario {
  return {
    inputCostChangePct: Number(draft.inputCostChangePct),
    demandChangePct: Number(draft.demandChangePct),
    leadTimeChangeDays: Number(draft.leadTimeChangeDays),
    targetMarginPct: Number(draft.targetMarginPct),
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
          { id: "profit-at-risk", type: "kpi", title: "Profit at risk", width: "1/2", data: { label: "Profit at risk", value: formatMoney(report.profitAtRisk), trend: report.profitAtRisk.minorUnits > 0 ? "down" : "neutral" } },
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
            title: "Manual scenario",
            width: "full",
            data: {
              stats: [
                { label: "Input cost change", value: `${report.scenario.inputCostChangePct}%` },
                { label: "Demand change", value: `${report.scenario.demandChangePct}%` },
                { label: "Extra lead time", value: `${report.scenario.leadTimeChangeDays} days` },
                { label: "Target gross margin", value: `${report.scenario.targetMarginPct}%` },
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
                { key: "profitAtRisk", label: "Profit at risk", align: "right" },
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
  return {
    title: "Margin & Supply Outlook",
    headers: ["Product", "Severity", "Baseline margin %", "Stressed margin %", "Profit at risk", "Days of cover", "Stock shortfall", "Advisory target unit price", "Warnings"],
    rows: preview.report.lines.map((line) => [
      line.productName,
      line.severity,
      line.baselineMarginPct ?? "",
      line.stressedMarginPct ?? "",
      line.profitAtRisk.minorUnits / 10 ** line.profitAtRisk.scale,
      line.daysOfCover ?? "",
      line.projectedStockShortfall,
      line.targetUnitPrice ? line.targetUnitPrice.minorUnits / 10 ** line.targetUnitPrice.scale : "",
      line.warningCodes.join(", "),
    ] as (string | number)[][][number]),
  }
}
