"use client"

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
  if (!amount) return "Unavailable (missing cost baseline)"
  return (amount.minorUnits / 10 ** amount.scale).toLocaleString(undefined, {
    minimumFractionDigits: amount.scale,
    maximumFractionDigits: amount.scale,
  })
}

const SUGGESTION_KIND_CONFIG: Record<MarginSupplySuggestion["kind"], SuggestionKindConfig> = {
  price_change: {
    title: "Price review",
    summary: (suggestion) => suggestion.kind === "price_change"
      ? `${formatMoney(suggestion.currentUnitPrice)} → ${formatMoney(suggestion.suggestedUnitPrice)} (${suggestion.priceChangePct.toFixed(1)}%)`
      : "",
    impact: (suggestion) => suggestion.kind === "price_change"
      ? `Conditional gross-profit uplift ${formatMoney(suggestion.conditionalGrossProfitUplift)} if all scenario units sell at the reviewed price; demand elasticity and mix response are not modeled`
      : "",
  },
  replenishment_change: {
    title: "Replenishment review",
    summary: (suggestion) => suggestion.kind === "replenishment_change"
      ? `Projected stockout ${suggestion.projectedShortfall.toLocaleString(undefined, { maximumFractionDigits: 2 })} units · available ${suggestion.currentAvailableQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} · reorder point ${suggestion.reorderPoint.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ${suggestion.effectiveLeadDays} day lead time`
      : "",
    impact: (suggestion) => suggestion.kind === "replenishment_change"
      ? "Quantity and working-capital requirement unavailable until location, open-PO, and order-multiple data are reviewed"
      : "",
  },
}

function readableCode(value: string): string {
  return value.replaceAll("_", " ").toLowerCase()
}

export function MarginSupplySuggestionReview({ data }: { data: unknown }) {
  const { previewIdentity, suggestions } = data as MarginSupplySuggestionReviewData
  const [reviewState, setReviewState] = useState<{ previewIdentity: string; reviewed: Set<string> }>(() => ({
    previewIdentity,
    reviewed: new Set(),
  }))
  const reviewed = reviewState.previewIdentity === previewIdentity
    ? reviewState.reviewed
    : new Set<string>()

  if (suggestions.length === 0) {
    return <p className="text-sm text-muted-foreground">No price or replenishment changes require review for this scenario.</p>
  }

  return (
    <div className="space-y-3" data-testid="margin-supply-suggestions">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        These are deterministic review warnings, not automatic actions. Marking an item reviewed does not change a price, create a purchase order, or update a replenishment rule.
      </div>
      {suggestions.map((suggestion) => {
        const config = SUGGESTION_KIND_CONFIG[suggestion.kind]
        const isReviewed = reviewed.has(suggestion.suggestionId)
        return (
          <article key={suggestion.suggestionId} className="space-y-3 rounded-lg border p-4" data-testid={`margin-supply-suggestion-${suggestion.suggestionId}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{suggestion.productName}{suggestion.sku ? ` · ${suggestion.sku}` : ""}</p>
                  <Badge variant={isReviewed ? "secondary" : "destructive"}>{isReviewed ? "Reviewed in this view" : "Review required"}</Badge>
                  <Badge variant="outline">{suggestion.confidence} confidence</Badge>
                </div>
                <p className="mt-1 text-sm font-medium">{config.title}: {config.summary(suggestion)}</p>
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
                {isReviewed ? "Return to review" : "Mark reviewed"}
              </Button>
            </div>

            {suggestion.dataQuality.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Data quality: {suggestion.dataQuality.map(readableCode).join(", ")}
              </p>
            ) : null}

            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Calculation evidence and provenance</summary>
              <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <ul className="list-disc space-y-1 pl-4">
                  {suggestion.evidence.map((item, index) => (
                    <li key={`${item.metric}-${item.source}-${index}`}>
                      {readableCode(item.metric)}: {item.value.toLocaleString()} {item.unit} · source {item.source}
                    </li>
                  ))}
                </ul>
                <p>Formula: {suggestion.provenance.formula}</p>
                <p>Calculation: {suggestion.provenance.calculationVersion} · scenario {suggestion.provenance.scenarioFingerprint}</p>
                <p>Source tables: {suggestion.provenance.sourceTables.join(", ")}</p>
                <p>Fingerprint: {suggestion.fingerprint}</p>
              </div>
            </details>
          </article>
        )
      })}
    </div>
  )
}
