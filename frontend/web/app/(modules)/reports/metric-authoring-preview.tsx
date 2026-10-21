"use client"

import { useTranslation } from "@lumiere/i18n"
import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Separator } from "@lumiere/ui/components/separator"
import { ChartNoAxesCombined, Info } from "lucide-react"
import { metricChoiceLabel, metricDefinitionPreview } from "./metric-authoring"

export interface MetricAuthoringPreviewProps {
  values: FormValues
  config: FormConfig
}

export function MetricAuthoringPreview({ values, config }: MetricAuthoringPreviewProps) {
  const { t, i18n } = useTranslation()
  const preview = metricDefinitionPreview(values)
  const unset = t("reports.authoring.metric.notSelected", { defaultValue: "Not selected" })
  const source = metricChoiceLabel(config, "model", preview.source) ?? unset
  const measure = metricChoiceLabel(config, "field", preview.measure) ?? unset
  const aggregation = metricChoiceLabel(config, "aggregation", preview.aggregation) ?? unset
  const period = metricChoiceLabel(config, "timePeriod", preview.period) ?? unset
  const company = metricChoiceLabel(config, "companyId", values.companyId)
  const formattedTarget = preview.target === null ? null : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(preview.target)

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={t("reports.authoring.metric.preview", { defaultValue: "Metric preview" })} data-testid="metric-authoring-preview">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline">{t("reports.authoring.metric.definition", { defaultValue: "Definition preview" })}</Badge>
            <Badge variant="secondary">{preview.metricType ?? unset}</Badge>
          </div>
          <CardTitle>{preview.name || t("reports.authoring.metric.untitled", { defaultValue: "Your metric" })}</CardTitle>
          <CardDescription>{period}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-4xl font-semibold tabular-nums" aria-label={t("reports.authoring.metric.noValue", { defaultValue: "No calculated value" })}>—</p>
          <p className="text-sm text-muted-foreground">{t("reports.authoring.metric.awaitingCalculation", { defaultValue: "No calculated value yet" })}</p>
          {preview.metricType === "Trend" || preview.metricType === "Comparison" ? (
            <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-muted-foreground">
              <ChartNoAxesCombined aria-hidden="true" />
              <p>{t("reports.authoring.metric.noSeries", { defaultValue: "Calculated values are needed to display this chart." })}</p>
            </div>
          ) : null}
          <Separator />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("reports.authoring.metric.source", { defaultValue: "Source documents" })}</dt><dd>{source}</dd>
            <dt className="text-muted-foreground">{t("reports.authoring.metric.calculation", { defaultValue: "Calculation" })}</dt><dd>{preview.aggregation === "Count" ? aggregation : `${aggregation} · ${measure}`}</dd>
            <dt className="text-muted-foreground">{t("reports.authoring.metric.company", { defaultValue: "Company" })}</dt><dd>{company ?? t("reports.authoring.metric.noCompany", { defaultValue: "No company selected" })}</dd>
            <dt className="text-muted-foreground">{t("reports.authoring.metric.target", { defaultValue: "Target" })}</dt><dd>{formattedTarget ?? t("reports.authoring.metric.noTarget", { defaultValue: "No target set" })}</dd>
          </dl>
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">{preview.active
            ? t("reports.authoring.metric.activeDefinition", { defaultValue: "The definition will be marked active." })
            : t("reports.authoring.metric.inactiveDefinition", { defaultValue: "The definition will be marked inactive." })}</p>
        </CardFooter>
      </Card>
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>{t("reports.authoring.metric.definitionOnly", { defaultValue: "Saves a definition only" })}</AlertTitle>
        <AlertDescription>{t("reports.authoring.metric.definitionOnlyHint", { defaultValue: "Saving does not calculate a value or start a refresh job. This preview does not sum documents or combine currencies. Values must be supplied through the existing metric update action." })}</AlertDescription>
      </Alert>
    </section>
  )
}
