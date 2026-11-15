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

const unavailableNotes: Record<string, string> = {
  missingIntake: "Record the opening intake.",
  invalidHeadcount: "Reconcile the headcount events.",
  incompleteMortalityCohort: "Confirm which animals are included after the cohort changed.",
  missingWeighIns: "Record two comparable weigh-ins.",
  ambiguousWeighIns: "Identify which weigh-ins to use.",
  changedWeighInCohort: "Use weigh-ins from the same cohort.",
  missingWholeFlockWeights: "Record comparable whole-batch weights.",
  missingFeedCoverage: "Confirm the feed records cover the weigh-in period.",
  missingFeedConsumption: "Record actual feed consumption.",
  nonpositiveWeightGain: "A positive weight gain is required.",
  noProcessing: "Record a processing run.",
  missingProcessingWeight: "Enter the measured input and output weights.",
  nonpositiveWeight: "Verify the weight used in the calculation.",
  missingRecognizedCosts: "Link verified costs attributable to sellable output.",
  missingTraceableSales: "Link verified sales and the costs of those units.",
}

function MetricRow<T>({
  label,
  metric,
  format,
}: {
  label: string
  metric?: FarmMetric<T>
  format: (value: T) => string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 px-4 py-3">
      <dt className="text-sm">{label}</dt>
      {metric?.status === "available" ? (
        <dd className={`text-sm ${workspaceStyles.metricValue}`}>{format(metric.value)}</dd>
      ) : (
        <dd className="text-sm text-muted-foreground">
          {metric?.status === "unavailable"
            ? (unavailableNotes[metric.reason] ?? "Unavailable")
            : "Unavailable"}
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
    <section className="space-y-2" aria-label="Linked posted costs">
      <h3 className={workspaceStyles.sectionTitle}>Linked posted costs</h3>
      <p className={workspaceStyles.sectionDescription}>
        Subtotal of verified, accessible journal lines linked to this batch.
      </p>
      {summary.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking linked costs…
        </p>
      )}
      {summary.isError && (
        <p role="status" className="text-sm text-muted-foreground">
          {summary.error instanceof FarmApiError && summary.error.status === 403
            ? "Access to the source ledger is required to see linked cost totals."
            : "Linked cost totals could not be checked."}
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
                <dt>{String(currencyById.get(currencyId) ?? `Currency #${currencyId}`)}</dt>
                <dd className={workspaceStyles.metricValue}>{amount}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.truncated || data.unverifiedLinks > 0
              ? "No amounts were verified in the linked costs checked."
              : "No verified linked costs through this date."}
          </p>
        ))}
      {data && (data.unverifiedLinks > 0 || data.truncated) && (
        <p className="text-sm text-muted-foreground">
          Some linked costs are outside this subtotal. Review the Costs tab for individual sources.
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
  const metrics = batch.metrics
  if (!metrics) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Metrics are unavailable for this batch.
      </p>
    )
  }
  const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 })
  const kg = (value: number) => `${quantity.format(value)} kg`
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label="Growth and survival">
        <h2 className={workspaceStyles.sectionTitle}>Growth and survival</h2>
        <dl className={`divide-y divide-border ${workspaceStyles.surface}`}>
          <MetricRow label="Live headcount" metric={metrics.liveHeadcount} format={quantity.format} />
          <MetricRow
            label="Recorded deaths"
            metric={{ status: "available", value: metrics.recordedDeaths }}
            format={quantity.format}
          />
          <MetricRow label="Mortality rate" metric={metrics.mortalityRate} format={percent.format} />
          <MetricRow
            label="Average daily gain"
            metric={metrics.averageDailyGainKg}
            format={(value) => `${kg(value)} per animal`}
          />
          <MetricRow
            label="Feed conversion ratio"
            metric={metrics.feedConversionRatio}
            format={(value) => `${quantity.format(value)} kg feed per kg gained`}
          />
        </dl>
        {metrics.growthWindow && (
          <p className={workspaceStyles.sectionDescription}>
            Weigh-ins from {farmDateLabel(metrics.growthWindow.openingDate, locale)} (
            {quantity.format(metrics.growthWindow.openingSampleCount)} sampled,{" "}
            {kg(metrics.growthWindow.openingMeanWeightKg)} mean) to{" "}
            {farmDateLabel(metrics.growthWindow.closingDate, locale)} (
            {quantity.format(metrics.growthWindow.closingSampleCount)} sampled,{" "}
            {kg(metrics.growthWindow.closingMeanWeightKg)} mean).
          </p>
        )}
      </section>
      <section className="space-y-2" aria-label="Processing and financial metrics">
        <h2 className={workspaceStyles.sectionTitle}>Processing and financial metrics</h2>
        <dl className={`divide-y divide-border ${workspaceStyles.surface}`}>
          <MetricRow label="Live processing input" metric={metrics.processingLiveInputKg} format={kg} />
          <MetricRow label="Sellable output" metric={metrics.processingSellableOutputKg} format={kg} />
          <MetricRow
            label="Processing yield"
            metric={metrics.processingYield}
            format={percent.format}
          />
          <MetricRow
            label="Cost per sellable kilogram"
            metric={metrics.costPerSellableKg}
            format={({ currency, minorUnitDigits, amountMinorPerKg }) =>
              formatCurrency(locale, currency, minorUnitDigits).format(
                amountMinorPerKg / 10 ** minorUnitDigits,
              )
            }
          />
          <MetricRow
            label="Margin"
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
