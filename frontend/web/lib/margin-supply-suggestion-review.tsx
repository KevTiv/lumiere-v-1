"use client"

import { i18n as rootI18n, useTranslation as useRootTranslation } from "@lumiere/i18n"
import { useState } from "react"
import type { MarginSupplySuggestion, MoneyAmount } from "@lumiere/erp-shared/report-schemas"
import { Badge } from "@lumiere/ui/components/badge"
import { Button } from "@lumiere/ui/components/button"

interface SuggestionKindConfig {
  title: string
  summary: (suggestion: MarginSupplySuggestion) => string
  impact: (suggestion: MarginSupplySuggestion) => string
}

export interface MarginSupplySuggestionReviewData {
  previewIdentity: string
  suggestions: MarginSupplySuggestion[]
}

function formatMoney(amount: MoneyAmount | null): string {
  if (!amount) return rootI18n.t("reports.suggestions.missingCostBaseline")
  return (amount.minorUnits / 10 ** amount.scale).toLocaleString(undefined, {
    minimumFractionDigits: amount.scale,
    maximumFractionDigits: amount.scale,
  })
}

const SUGGESTION_KIND_CONFIG: Record<MarginSupplySuggestion["kind"], SuggestionKindConfig> = {
  price_change: {
    get title() { return rootI18n.t("reports.builtIn.marginSupplySuggestionReview.sUGGESTIONKINDCONFIG.priceReview.title") },
    summary: (suggestion) => suggestion.kind === "price_change"
      ? `${formatMoney(suggestion.currentUnitPrice)} → ${formatMoney(suggestion.suggestedUnitPrice)} (${suggestion.priceChangePct.toFixed(1)}%)`
      : "",
    impact: (suggestion) => suggestion.kind === "price_change"
      ? rootI18n.t("reports.suggestions.profitImpact", { amount: formatMoney(suggestion.conditionalGrossProfitUplift) })
      : "",
  },
  replenishment_change: {
    get title() { return rootI18n.t("reports.builtIn.marginSupplySuggestionReview.sUGGESTIONKINDCONFIG.replenishmentReview.title") },
    summary: (suggestion) => suggestion.kind === "replenishment_change"
      ? rootI18n.t("reports.suggestions.stockSummary", { shortfall: suggestion.projectedShortfall.toLocaleString(undefined, { maximumFractionDigits: 2 }), available: suggestion.currentAvailableQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 }), reorderPoint: suggestion.reorderPoint.toLocaleString(undefined, { maximumFractionDigits: 2 }), days: suggestion.effectiveLeadDays, count: suggestion.effectiveLeadDays })
      : "",
    impact: (suggestion) => suggestion.kind === "replenishment_change"
      ? rootI18n.t("reports.suggestions.replenishmentImpact")
      : "",
  },
}

function readableCode(value: string): string {
  switch (value) {
    case "MISSING_COST_BASELINE": return rootI18n.t("reports.marginSupply.codes.MISSING_COST_BASELINE", { defaultValue: "missing cost baseline" })
    case "MARGIN_BELOW_TARGET": return rootI18n.t("reports.marginSupply.codes.MARGIN_BELOW_TARGET", { defaultValue: "margin below target" })
    case "PROFIT_AT_RISK": return rootI18n.t("reports.marginSupply.codes.PROFIT_AT_RISK", { defaultValue: "profit at risk" })
    case "STOCKOUT_BEFORE_REPLENISHMENT": return rootI18n.t("reports.marginSupply.codes.STOCKOUT_BEFORE_REPLENISHMENT", { defaultValue: "stockout before replenishment" })
    case "REPLENISHMENT_THRESHOLD_BREACH": return rootI18n.t("reports.marginSupply.codes.REPLENISHMENT_THRESHOLD_BREACH", { defaultValue: "replenishment threshold breach" })
    case "MISSING_LEAD_TIME_BASELINE": return rootI18n.t("reports.marginSupply.codes.MISSING_LEAD_TIME_BASELINE", { defaultValue: "missing lead time baseline" })
    case "STALE_INVENTORY_COUNT": return rootI18n.t("reports.marginSupply.codes.STALE_INVENTORY_COUNT", { defaultValue: "stale inventory count" })
    case "SALES_PRICE_IS_PERIOD_WEIGHTED_AVERAGE": return rootI18n.t("reports.marginSupply.codes.SALES_PRICE_IS_PERIOD_WEIGHTED_AVERAGE", { defaultValue: "sales price is period weighted average" })
    case "COST_IS_SALES_LINE_SNAPSHOT_NOT_POSTED_COGS": return rootI18n.t("reports.marginSupply.codes.COST_IS_SALES_LINE_SNAPSHOT_NOT_POSTED_COGS", { defaultValue: "cost is sales line snapshot not posted cogs" })
    case "USER_PROVIDED_SCENARIO_ASSUMPTIONS": return rootI18n.t("reports.marginSupply.codes.USER_PROVIDED_SCENARIO_ASSUMPTIONS", { defaultValue: "user provided scenario assumptions" })
    case "NO_PRICE_ELASTICITY_OR_MIX_RESPONSE_MODELED": return rootI18n.t("reports.marginSupply.codes.NO_PRICE_ELASTICITY_OR_MIX_RESPONSE_MODELED", { defaultValue: "no price elasticity or mix response modeled" })
    case "DEMAND_IS_THIRTY_DAY_SALES_PROXY": return rootI18n.t("reports.marginSupply.codes.DEMAND_IS_THIRTY_DAY_SALES_PROXY", { defaultValue: "demand is thirty day sales proxy" })
    case "INVENTORY_IS_AGGREGATED_CURRENT_SNAPSHOT": return rootI18n.t("reports.marginSupply.codes.INVENTORY_IS_AGGREGATED_CURRENT_SNAPSHOT", { defaultValue: "inventory is aggregated current snapshot" })
    case "QUANTITY_REQUIRES_LOCATION_OPEN_PO_AND_ORDER_MULTIPLE_DATA": return rootI18n.t("reports.marginSupply.codes.QUANTITY_REQUIRES_LOCATION_OPEN_PO_AND_ORDER_MULTIPLE_DATA", { defaultValue: "quantity requires location open po and order multiple data" })
    case "current_unit_price": return rootI18n.t("reports.marginSupply.codes.current_unit_price", { defaultValue: "current unit price" })
    case "stressed_unit_cost": return rootI18n.t("reports.marginSupply.codes.stressed_unit_cost", { defaultValue: "stressed unit cost" })
    case "target_gross_margin": return rootI18n.t("reports.marginSupply.codes.target_gross_margin", { defaultValue: "target gross margin" })
    case "stressed_scenario_quantity": return rootI18n.t("reports.marginSupply.codes.stressed_scenario_quantity", { defaultValue: "stressed scenario quantity" })
    case "available_quantity": return rootI18n.t("reports.marginSupply.codes.available_quantity", { defaultValue: "available quantity" })
    case "projected_demand_during_lead": return rootI18n.t("reports.marginSupply.codes.projected_demand_during_lead", { defaultValue: "projected demand during lead" })
    case "reorder_point": return rootI18n.t("reports.marginSupply.codes.reorder_point", { defaultValue: "reorder point" })
    case "effective_lead_days": return rootI18n.t("reports.marginSupply.codes.effective_lead_days", { defaultValue: "effective lead days" })
    default: return value.replaceAll("_", " ").toLowerCase()
  }
}

function readableUnit(unit: string): string {
  switch (unit) {
    case "minor_currency_units": return rootI18n.t("reports.marginSupply.units.minor_currency_units", { defaultValue: "minor currency units" })
    case "percent": return rootI18n.t("reports.marginSupply.units.percent", { defaultValue: "percent" })
    case "quantity": return rootI18n.t("reports.marginSupply.units.quantity", { defaultValue: "quantity" })
    case "days": return rootI18n.t("reports.marginSupply.units.days", { defaultValue: "days" })
    default: return unit
  }
}

export function MarginSupplySuggestionReview({ data }: { data: unknown }) {
  useRootTranslation()
  const { previewIdentity, suggestions } = data as MarginSupplySuggestionReviewData
  const [reviewState, setReviewState] = useState<{ previewIdentity: string; reviewed: Set<string> }>(() => ({
    previewIdentity,
    reviewed: new Set(),
  }))
  const reviewed = reviewState.previewIdentity === previewIdentity
    ? reviewState.reviewed
    : new Set<string>()

  if (suggestions.length === 0) {
    return <p className="text-sm text-muted-foreground">{rootI18n.t("reports.ui.marginSupplySuggestionReview.noPriceOrReplenishmentChangesRequireReviewFor")}</p>
  }

  return (
    <div className="space-y-3" data-testid="margin-supply-suggestions">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        {rootI18n.t("reports.ui.marginSupplySuggestionReview.theseAreDeterministicReviewWarningsNotAutomaticActions")}</div>
      {suggestions.map((suggestion) => {
        const config = SUGGESTION_KIND_CONFIG[suggestion.kind]
        const isReviewed = reviewed.has(suggestion.suggestionId)
        return (
          <article key={suggestion.suggestionId} className="space-y-3 rounded-lg border p-4" data-testid={`margin-supply-suggestion-${suggestion.suggestionId}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{suggestion.productName}{suggestion.sku ? ` · ${suggestion.sku}` : ""}</p>
                  <Badge variant={isReviewed ? "secondary" : "destructive"}>{isReviewed ? rootI18n.t("reports.ui.marginSupplySuggestionReview.reviewedInThisView") : rootI18n.t("reports.ui.marginSupplySuggestionReview.reviewRequired")}</Badge>
                  <Badge variant="outline">{rootI18n.t("reports.suggestions.confidence", { level: suggestion.confidence === "medium" ? rootI18n.t("reports.marginSupply.confidence.medium", { defaultValue: "medium" }) : rootI18n.t("reports.marginSupply.confidence.low", { defaultValue: "low" }) })}</Badge>
                </div>
                <p className="mt-1 text-sm font-medium">{rootI18n.t("reports.marginSupply.suggestionSummary", { defaultValue: "{{title}}: {{summary}}", title: config.title, summary: config.summary(suggestion) })}</p>
                <p className="text-sm text-muted-foreground">{config.impact(suggestion)}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReviewState((current) => {
                  const currentReviewed = current.previewIdentity === previewIdentity
                    ? current.reviewed
                    : new Set<string>()
                  const next = new Set(currentReviewed)
                  if (isReviewed) next.delete(suggestion.suggestionId)
                  else next.add(suggestion.suggestionId)
                  return { previewIdentity, reviewed: next }
                })}
              >
                {isReviewed ? rootI18n.t("reports.ui.marginSupplySuggestionReview.returnToReview") : rootI18n.t("reports.ui.marginSupplySuggestionReview.markReviewed")}
              </Button>
            </div>

            {suggestion.dataQuality.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {rootI18n.t("reports.suggestions.dataQuality", { details: suggestion.dataQuality.map(readableCode).join(", ") })}
              </p>
            ) : null}

            <details className="text-sm">
              <summary className="cursor-pointer font-medium">{rootI18n.t("reports.ui.marginSupplySuggestionReview.calculationEvidenceAndProvenance")}</summary>
              <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <ul className="list-disc space-y-1 pl-4">
                  {suggestion.evidence.map((item, index) => (
                    <li key={`${item.metric}-${item.source}-${index}`}>
                      {rootI18n.t("reports.marginSupply.evidence", { defaultValue: "{{metric}}: {{value}} {{unit}} \u00b7 source: {{source}}", metric: readableCode(item.metric), value: item.value.toLocaleString(), unit: readableUnit(item.unit), source: item.source })}
                    </li>
                  ))}
                </ul>
                <p>{rootI18n.t("reports.marginSupply.formula", { defaultValue: "Formula: {{formula}}", formula: suggestion.provenance.formula })}</p>
                <p>{rootI18n.t("reports.marginSupply.calculation", { defaultValue: "Calculation {{version}} \u00b7 scenario {{fingerprint}}", version: suggestion.provenance.calculationVersion, fingerprint: suggestion.provenance.scenarioFingerprint })}</p>
                <p>{rootI18n.t("reports.marginSupply.sourceTables", { defaultValue: "Source tables: {{tables}}", tables: suggestion.provenance.sourceTables.join(", ") })}</p>
                <p>{rootI18n.t("reports.marginSupply.fingerprint", { defaultValue: "Fingerprint: {{fingerprint}}", fingerprint: suggestion.fingerprint })}</p>
              </div>
            </details>
          </article>
        )
      })}
    </div>
  )
}
