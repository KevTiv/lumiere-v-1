import { useTranslation } from "@lumiere/i18n"
import { useQuery } from "@tanstack/react-query"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { workspaceStyles } from "@lumiere/ui/lib/workspace-styles"
import {
  FarmApiError,
  farmApiPath,
  farmDateLabel,
  farmRequest,
  type FarmBatchDetail,
  type FarmMetric,
} from "./farm-batch-model"

const unavailableNotes = {
  missingIntake: "farmBatches.recordTheOpeningIntake",
  invalidHeadcount: "farmBatches.reconcileTheHeadcountEvents",
  incompleteMortalityCohort: "farmBatches.confirmWhichAnimalsAreIncludedAfterThe",
  missingWeighIns: "farmBatches.recordTwoComparableWeighins",
  ambiguousWeighIns: "farmBatches.identifyWhichWeighinsToUse",
  changedWeighInCohort: "farmBatches.useWeighinsFromTheSameCohort",
  missingWholeFlockWeights: "farmBatches.recordComparableWholebatchWeights",
  missingFeedCoverage: "farmBatches.confirmTheFeedRecordsCoverTheWeighin",
  missingFeedConsumption: "farmBatches.recordActualFeedConsumption",
  nonpositiveWeightGain: "farmBatches.aPositiveWeightGainIsRequired",
  noProcessing: "farmBatches.recordAProcessingRun",
  missingProcessingWeight: "farmBatches.enterTheMeasuredInputAndOutputWeights",
  nonpositiveWeight: "farmBatches.verifyTheWeightUsedInTheCalculation",
  missingRecognizedCosts: "farmBatches.unavailableUntilPostedProductionCostsCanBe",
  missingTraceableSales: "farmBatches.unavailableUntilPostedInvoicesAndCreditNotes",
} as const

function MetricRow<T>({
  label,
  metric,
  format,
}: {
  label: string
  metric?: FarmMetric<T>
  format: (value: T) => string
}) {
  const { t } = useTranslation()
  const reason = metric?.status === "unavailable"
    ? unavailableNotes[metric.reason as keyof typeof unavailableNotes]
    : undefined
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 px-4 py-3">
      <dt className="text-sm">{label}</dt>
      {metric?.status === "available" ? (
        <dd className={`text-sm ${workspaceStyles.metricValue}`}>{format(metric.value)}</dd>
      ) : (
        <dd className="text-sm text-muted-foreground">
          {t(reason ?? "farmBatches.unavailable")}
        </dd>
      )}
    </div>
  )
}

function formatCurrency(locale: string, currency: string, digits: number) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatMargin(
  locale: string,
  value: { currency: string; minorUnitDigits: number; amountMinor: string },
) {
  const minor = BigInt(value.amountMinor)
  const digits = value.minorUnitDigits
  const scale = 10n ** BigInt(digits)
  const integer = minor / scale
  const remainder = minor % scale
  const fraction = (remainder < 0n ? -remainder : remainder).toString().padStart(digits, "0")
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false })
  return formatCurrency(locale, value.currency, digits)
    .formatToParts(integer === 0n && minor < 0n ? -0 : integer)
    .map((part) =>
      part.type === "fraction"
        ? Array.from(fraction, (digit) => digitFormatter.format(Number(digit))).join("")
        : part.value,
    )
    .join("")
}

type PostedCostSummary = {
  asOf: string
  checkedLinks: number
  verifiedLinks: number
  unverifiedLinks: number
  truncated: boolean
  totals: { currencyId: string; amount: string }[]
}

function LinkedPostedCosts({
  batchId,
  companyId,
  scopeKey,
  asOf,
}: {
  batchId: string
  companyId: string
  scopeKey: string
  asOf: string
}) {
  const { t } = useTranslation()
  const summary = useQuery({
    queryKey: ["farm-linked-posted-costs", scopeKey, companyId, batchId, asOf],
    queryFn: ({ signal }) =>
      farmRequest<PostedCostSummary>(
        farmApiPath(companyId, `/${batchId}/linked-posted-costs`, { asOf }),
        { signal },
      ),
    retry: (count, error) => count < 1 && !(error instanceof FarmApiError && error.status === 403),
  })
  const currencies = useCurrencies()
  const currencyById = new Map(currencies.data?.map((row) => [String(row.id), row.code]))
  const data = summary.isSuccess ? summary.data : undefined

  return (
    <section className="space-y-2" aria-label={t("farmBatches.linkedPostedCosts")}>
      <h3 className={workspaceStyles.sectionTitle}>{t("farmBatches.linkedPostedCosts")}</h3>
      <p className={workspaceStyles.sectionDescription}>
        {t("farmBatches.subtotalOfVerifiedAccessibleJournalLinesLinked")}
      </p>
      {summary.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("farmBatches.checkingLinkedCosts")}
        </p>
      )}
      {summary.isError && (
        <p role="status" className="text-sm text-muted-foreground">
          {summary.error instanceof FarmApiError && summary.error.status === 403
            ? t("farmBatches.accessToTheSourceLedgerIsRequired")
            : t("farmBatches.linkedCostTotalsCouldNotBeChecked")}
        </p>
      )}
      {data &&
        (data.totals.length ? (
          <dl className={`divide-y divide-border ${workspaceStyles.surface}`}>
            {data.totals.map(({ currencyId, amount }) => (
              <div
                key={currencyId}
                className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3 text-sm"
              >
                <dt>{String(currencyById.get(currencyId) ?? t("farmBatches.currencyLabel", { id: currencyId }))}</dt>
                <dd className={workspaceStyles.metricValue}>{amount}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.truncated || data.unverifiedLinks > 0
              ? t("farmBatches.noAmountsWereVerifiedInTheLinked")
              : t("farmBatches.noVerifiedLinkedCostsThroughThisDate")}
          </p>
        ))}
      {data && (data.unverifiedLinks > 0 || data.truncated) && (
        <p className="text-sm text-muted-foreground">
          {t("farmBatches.someLinkedCostsAreOutsideThisSubtotal")}
        </p>
      )}
    </section>
  )
}

export function FarmMetricsView({
  batch,
  locale,
  companyId,
  scopeKey,
}: {
  batch: FarmBatchDetail
  locale: string
  companyId: string
  scopeKey: string
}) {
  const { t } = useTranslation()
  const metrics = batch.metrics
  if (!metrics) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("farmBatches.metricsAreUnavailableForThisBatch")}
      </p>
    )
  }
  const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 })
  const kg = (value: number) => `${quantity.format(value)} kg`
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label={t("farmBatches.growthAndSurvival")}>
        <h2 className={workspaceStyles.sectionTitle}>{t("farmBatches.growthAndSurvival")}</h2>
        <dl className={`divide-y divide-border ${workspaceStyles.surface}`}>
          <MetricRow label={t("farmBatches.liveHeadcount")} metric={metrics.liveHeadcount} format={quantity.format} />
          <MetricRow
            label={t("farmBatches.recordedDeaths")}
            metric={{ status: "available", value: metrics.recordedDeaths }}
            format={quantity.format}
          />
          <MetricRow label={t("farmBatches.mortalityRate")} metric={metrics.mortalityRate} format={percent.format} />
          <MetricRow
            label={t("farmBatches.averageDailyGain")}
            metric={metrics.averageDailyGainKg}
            format={(value) => t("farmBatches.kgPerAnimal", { value: quantity.format(value) })}
          />
          <MetricRow
            label={t("farmBatches.feedConversionRatio")}
            metric={metrics.feedConversionRatio}
            format={(value) => t("farmBatches.feedPerKg", { value: quantity.format(value) })}
          />
        </dl>
        {metrics.growthWindow && (
          <p className={workspaceStyles.sectionDescription}>
            {t("farmBatches.growthWindow", {
              openingDate: farmDateLabel(metrics.growthWindow.openingDate, locale),
              openingSample: quantity.format(metrics.growthWindow.openingSampleCount),
              openingMean: kg(metrics.growthWindow.openingMeanWeightKg),
              closingDate: farmDateLabel(metrics.growthWindow.closingDate, locale),
              closingSample: quantity.format(metrics.growthWindow.closingSampleCount),
              closingMean: kg(metrics.growthWindow.closingMeanWeightKg),
            })}
          </p>
        )}
      </section>
      <section className="space-y-2" aria-label={t("farmBatches.processingAndFinancialMetrics")}>
        <h2 className={workspaceStyles.sectionTitle}>{t("farmBatches.processingAndFinancialMetrics")}</h2>
        <dl className={`divide-y divide-border ${workspaceStyles.surface}`}>
          <MetricRow label={t("farmBatches.liveProcessingInput")} metric={metrics.processingLiveInputKg} format={kg} />
          <MetricRow label={t("farmBatches.sellableOutput")} metric={metrics.processingSellableOutputKg} format={kg} />
          <MetricRow
            label={t("farmBatches.processingYield")}
            metric={metrics.processingYield}
            format={percent.format}
          />
          <MetricRow
            label={t("farmBatches.costPerSellableKilogram")}
            metric={metrics.costPerSellableKg}
            format={({ currency, minorUnitDigits, amountMinorPerKg }) =>
              formatCurrency(locale, currency, minorUnitDigits).format(
                amountMinorPerKg / 10 ** minorUnitDigits,
              )
            }
          />
          <MetricRow
            label={t("farmBatches.margin")}
            metric={metrics.margin}
            format={(value) => formatMargin(locale, value)}
          />
        </dl>
        <LinkedPostedCosts
          batchId={batch.id}
          companyId={companyId}
          scopeKey={scopeKey}
          asOf={metrics.asOf}
        />
      </section>
    </div>
  )
}
