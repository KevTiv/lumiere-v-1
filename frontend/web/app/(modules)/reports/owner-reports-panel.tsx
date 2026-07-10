"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@lumiere/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@lumiere/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { Badge } from "@lumiere/ui/components/badge"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import {
  AlertCircle,
  Building2,
  CalendarDays,
  Clock,
  Eye,
  FileText,
} from "lucide-react"

import type {
  DailyBusinessSummaryReportV1,
  MoneyAmount,
  ReportCatalogEntry,
  ReportEnvelope,
} from "@lumiere/erp-shared/report-schemas"
import { isReportPreviewAvailable } from "@lumiere/erp-shared/report-schemas"
import {
  useReportCatalog,
  useReportPreview,
} from "@lumiere/query-hooks/hooks/owner-reports"
import { useToast } from "@/hooks/use-toast"

interface OwnerReportsPanelProps {
  organizationId: bigint
  companies: Record<string, unknown>[]
  defaultCompanyId?: number
}

function formatMoney(amount: MoneyAmount): string {
  const value = amount.minorUnits / 10 ** amount.scale
  return value.toLocaleString(undefined, {
    minimumFractionDigits: amount.scale,
    maximumFractionDigits: amount.scale,
  })
}

function companyRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id ?? ""),
    label: String(row.name ?? row.id ?? ""),
  }))
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

function timezoneInputValue(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function OwnerReportsPanel({
  organizationId,
  companies,
  defaultCompanyId,
}: OwnerReportsPanelProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const catalog = useReportCatalog(organizationId)
  const preview = useReportPreview(organizationId)

  const companyOptions = useMemo(
    () => companyRowsToSelectOptions(companies),
    [companies],
  )

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    if (defaultCompanyId && defaultCompanyId > 0) return String(defaultCompanyId)
    const first = companyOptions[0]
    return first?.value ?? ""
  })
  const [date, setDate] = useState(todayInputValue)
  const [timezone] = useState(timezoneInputValue)
  const [activePreview, setActivePreview] = useState<
    ReportEnvelope<DailyBusinessSummaryReportV1> | null
  >(null)

  useEffect(() => {
    if (defaultCompanyId && defaultCompanyId > 0) {
      setSelectedCompanyId(String(defaultCompanyId))
    }
  }, [defaultCompanyId])

  useEffect(() => {
    if (!preview.error) return
    toast({
      title: t("reports.ownerReports.previewErrorTitle"),
      description:
        preview.error instanceof Error
          ? preview.error.message
          : t("reports.ownerReports.previewErrorDescription"),
      variant: "destructive",
    })
  }, [preview.error, t, toast])

  const handlePreview = async (entry: ReportCatalogEntry) => {
    setActivePreview(null)
    const companyId = Number(selectedCompanyId)
    if (!Number.isFinite(companyId) || companyId <= 0) {
      toast({
        title: t("reports.ownerReports.noCompanyTitle"),
        description: t("reports.ownerReports.noCompanyDescription"),
        variant: "destructive",
      })
      return
    }
    const result = await preview.mutateAsync({
      reportKey: entry.key,
      companyId,
      date,
      timezone,
    })
    setActivePreview(result)
  }

  if (catalog.isLoading) {
    return <OwnerReportsPanelSkeleton />
  }

  if (catalog.error) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{t("reports.ownerReports.catalogErrorTitle")}</AlertTitle>
        <AlertDescription>
          {t("reports.ownerReports.catalogErrorDescription")}
        </AlertDescription>
      </Alert>
    )
  }

  const entries = catalog.data?.reports ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("reports.ownerReports.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("reports.ownerReports.description")}
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel>{t("reports.ownerReports.companyLabel")}</FieldLabel>
              <Select
                value={selectedCompanyId}
                onValueChange={setSelectedCompanyId}
                disabled={companyOptions.length === 0}
              >
                <SelectTrigger>
                  <Building2 data-icon="inline-start" />
                  <SelectValue
                    placeholder={t("reports.ownerReports.companyPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {companyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("reports.ownerReports.dateLabel")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <CalendarDays />
                </InputGroupAddon>
                <InputGroupInput
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </InputGroup>
            </Field>

            <Field>
              <FieldLabel>{t("reports.ownerReports.timezoneLabel")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <Clock />
                </InputGroupAddon>
                <InputGroupInput type="text" value={timezone} readOnly />
              </InputGroup>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <Alert>
          <FileText />
          <AlertTitle>{t("reports.ownerReports.emptyCatalogTitle")}</AlertTitle>
          <AlertDescription>
            {t("reports.ownerReports.emptyCatalogDescription")}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <ReportCard
              key={entry.key}
              entry={entry}
              isPending={
                preview.isPending &&
                activePreview?.reportKey !== entry.key
              }
              onPreview={() => handlePreview(entry)}
            />
          ))}
        </div>
      )}

      {preview.isPending && !activePreview && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      )}

      {activePreview && !preview.isPending && (
        <ReportPreviewPanel preview={activePreview} />
      )}
    </div>
  )
}

interface ReportCardProps {
  entry: ReportCatalogEntry
  isPending: boolean
  onPreview: () => void
}

function ReportCard({ entry, isPending, onPreview }: ReportCardProps) {
  const { t } = useTranslation()
  const previewable = isReportPreviewAvailable(entry)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{entry.title}</CardTitle>
          <Badge variant={previewable ? "default" : "secondary"}>
            {t(`reports.ownerReports.availability.${entry.availability}`)}
          </Badge>
        </div>
        <CardDescription>{entry.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {entry.mandatorySections.map((section) => (
            <Badge key={section} variant="outline">
              {section}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t("reports.ownerReports.maxWindowDays", {
              count: entry.maxWindowDays,
            })}
          </span>
          <Button
            size="sm"
            disabled={!previewable || isPending}
            onClick={onPreview}
          >
            <Eye data-icon="inline-start" />
            {t("reports.ownerReports.previewButton")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface ReportPreviewPanelProps {
  preview: ReportEnvelope<DailyBusinessSummaryReportV1>
}

function ReportPreviewPanel({ preview }: ReportPreviewPanelProps) {
  const { t } = useTranslation()
  const report = preview.report

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold tracking-tight">
          {t("reports.ownerReports.previewTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {preview.reportKey} · v{preview.schemaVersion}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ScopeItem
          label={t("reports.ownerReports.scope.company")}
          value={String(preview.scope.companyId)}
        />
        <ScopeItem
          label={t("reports.ownerReports.scope.dateFrom")}
          value={preview.scope.dateFrom}
        />
        <ScopeItem
          label={t("reports.ownerReports.scope.dateTo")}
          value={preview.scope.dateToExclusive}
        />
        <ScopeItem
          label={t("reports.ownerReports.scope.timezone")}
          value={preview.scope.timezone}
        />
      </div>

      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{t("reports.ownerReports.watermarkTitle")}</AlertTitle>
        <AlertDescription>{preview.watermark}</AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t("reports.ownerReports.totals.salesGross")}
          value={formatMoney(report.totals.salesGross)}
        />
        <StatCard
          label={t("reports.ownerReports.totals.purchasesGross")}
          value={formatMoney(report.totals.purchasesGross)}
        />
        <StatCard
          label={t("reports.ownerReports.totals.receipts")}
          value={formatMoney(report.totals.receipts)}
        />
        <StatCard
          label={t("reports.ownerReports.totals.disbursements")}
          value={formatMoney(report.totals.disbursements)}
        />
        <StatCard
          label={t("reports.ownerReports.totals.feesAndTax")}
          value={formatMoney(report.totals.feesAndTax)}
        />
        <StatCard
          label={t("reports.ownerReports.totals.netCashFlow")}
          value={formatMoney(report.totals.netCashFlow)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SummaryCard
          title={t("reports.ownerReports.sections.sales")}
          count={report.sales.orderCount}
          net={formatMoney(report.sales.net)}
          tax={formatMoney(report.sales.tax)}
          gross={formatMoney(report.sales.gross)}
        />
        <SummaryCard
          title={t("reports.ownerReports.sections.purchases")}
          count={report.purchases.orderCount}
          net={formatMoney(report.purchases.net)}
          tax={formatMoney(report.purchases.tax)}
          gross={formatMoney(report.purchases.gross)}
        />
      </div>

      <ReceiptsCard receipts={report.receipts} />
      <ExpensesAndFeesCard expenses={report.expensesAndFees} />
      <StockAlertsCard alerts={report.stockAlerts} />
      <ExceptionsCard exceptions={report.exceptions} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("reports.ownerReports.caveatsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground">
            {preview.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("reports.ownerReports.sourceWatermarkTitle")}
          </CardTitle>
          <CardDescription>
            {t("reports.ownerReports.sourceWatermarkCutoff", {
              cutoff: preview.sourceWatermark.accountingCutoff,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {preview.sourceWatermark.sourceRows.map((row) => (
              <div
                key={row.source}
                className="flex flex-col gap-1 rounded-lg border p-3"
              >
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  {row.source}
                </span>
                <span className="text-lg font-semibold">{row.rows}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ScopeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-4">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
      </CardContent>
    </Card>
  )
}

function SummaryCard({
  title,
  count,
  net,
  tax,
  gross,
}: {
  title: string
  count: number
  net: string
  tax: string
  gross: string
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {t("reports.ownerReports.ordersCount", { count })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t("reports.ownerReports.columns.net")}
            </span>
            <span className="font-medium">{net}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t("reports.ownerReports.columns.tax")}
            </span>
            <span className="font-medium">{tax}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t("reports.ownerReports.columns.gross")}
            </span>
            <span className="font-medium">{gross}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ReceiptsCard({
  receipts,
}: {
  receipts: DailyBusinessSummaryReportV1["receipts"]
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("reports.ownerReports.sections.receipts")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t("reports.ownerReports.receipts.receiptCount", {
                count: receipts.receiptCount,
              })}
            </span>
            <span className="text-xl font-semibold">
              {formatMoney(receipts.receiptTotal)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t("reports.ownerReports.receipts.disbursementCount", {
                count: receipts.disbursementCount,
              })}
            </span>
            <span className="text-xl font-semibold">
              {formatMoney(receipts.disbursementTotal)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ExpensesAndFeesCard({
  expenses,
}: {
  expenses: DailyBusinessSummaryReportV1["expensesAndFees"]
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("reports.ownerReports.sections.expensesAndFees")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatItem
            label={t("reports.ownerReports.columns.fees")}
            value={formatMoney(expenses.fees)}
          />
          <StatItem
            label={t("reports.ownerReports.columns.tax")}
            value={formatMoney(expenses.tax)}
          />
          <StatItem
            label={t("reports.ownerReports.columns.total")}
            value={formatMoney(expenses.total)}
          />
          <StatItem
            label={t("reports.ownerReports.columns.feeCount")}
            value={String(expenses.feeCount)}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function StockAlertsCard({
  alerts,
}: {
  alerts: DailyBusinessSummaryReportV1["stockAlerts"]
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("reports.ownerReports.sections.stockAlerts")}
        </CardTitle>
        <CardDescription>
          {t("reports.ownerReports.stockAlerts.count", {
            count: alerts.alertCount,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {alerts.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("reports.ownerReports.stockAlerts.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.lines.slice(0, 6).map((line) => (
              <div
                key={line.quantId}
                className="flex flex-col gap-1 rounded-lg border p-3"
              >
                <span className="text-xs text-muted-foreground">
                  {t("reports.ownerReports.stockAlerts.productId", {
                    id: line.productId,
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {t("reports.ownerReports.stockAlerts.available", {
                      value: line.available,
                    })}
                  </span>
                  {line.outdated && (
                    <Badge variant="outline">
                      {t("reports.ownerReports.stockAlerts.outdated")}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ExceptionsCard({
  exceptions,
}: {
  exceptions: DailyBusinessSummaryReportV1["exceptions"]
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("reports.ownerReports.sections.exceptions")}
        </CardTitle>
        <CardDescription>
          {t("reports.ownerReports.exceptions.count", {
            count: exceptions.count,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {exceptions.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("reports.ownerReports.exceptions.empty")}
          </p>
        ) : (
          <ul className="flex list-disc flex-col gap-2 pl-4 text-sm">
            {exceptions.lines.slice(0, 10).map((line, index) => (
              <li key={`${line.code}-${line.sourceId}-${index}`}>
                <span className="font-medium">[{line.code}]</span>{" "}
                {line.message}
                <span className="text-muted-foreground">
                  {" "}
                  ({line.source} #{line.sourceId})
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function OwnerReportsPanelSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  )
}
