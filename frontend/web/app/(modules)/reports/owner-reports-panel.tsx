"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button, buttonVariants } from "@lumiere/ui/components/button"
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
  Download,
} from "lucide-react"

import type {
  DailyBusinessSummaryReportV1,
  LowStockReportV1,
  MoneyAmount,
  ReportCatalogEntry,
  ReportPreview,
  StockMovementReportV1,
} from "@lumiere/erp-shared/report-schemas"
import { isReportPreviewAvailable } from "@lumiere/erp-shared/report-schemas"
import {
  useReportCatalog,
  useGeneratedOwnerReportHistory,
  useReportPdf,
  useReportPreview,
  useCreateOwnerReportSchedule,
  useOwnerReportScheduleRecipients,
  useOwnerReportSchedules,
  useRunOwnerReportSchedule,
  useUpdateOwnerReportSchedule,
} from "@lumiere/query-hooks/hooks/owner-reports"
import { downloadPivotTableXlsx } from "@lumiere/query-hooks/hooks/templates"
import { companyRowsToSelectOptions } from "@/lib/form-lookup"
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

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

function timezoneInputValue(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function ownerReportXlsxData(preview: ReportPreview): { title: string; headers: string[]; rows: (string | number)[][] } {
  if (preview.reportKey === "low_stock_v1") return { title: "Low Stock Report", headers: ["Product", "SKU", "Available", "Reorder point", "Forecast"], rows: preview.report.lines.map((line) => [line.name, line.sku ?? "", line.available, line.reorderPoint, line.forecast]) }
  if (preview.reportKey === "stock_movement_v1") return { title: "Stock Movement Report", headers: ["Product", "Source", "Destination", "Quantity", "Value"], rows: preview.report.lines.map((line) => [line.productName, line.sourceLocation, line.destinationLocation, line.quantity, line.valuationReference.minorUnits / 10 ** line.valuationReference.scale]) }
  if (preview.reportKey === "sales_by_product_v1") return { title: "Sales by Product", headers: ["Product", "Quantity", "Gross sales", "Net sales", "Returns", "Margin"], rows: preview.report.lines.map((line) => [line.productName, line.quantity, line.grossSales.minorUnits / 10 ** line.grossSales.scale, line.netSales.minorUnits / 10 ** line.netSales.scale, line.returns.minorUnits / 10 ** line.returns.scale, line.margin.minorUnits / 10 ** line.margin.scale]) }
  if (preview.reportKey === "purchase_spend_v1") return { title: "Purchase Spend", headers: ["Supplier", "Product", "Quantity", "Spend"], rows: preview.report.lines.map((line) => [line.supplierName, line.productName, line.quantity, line.spend.minorUnits / 10 ** line.spend.scale]) }
  if (preview.reportKey === "payment_fee_summary_v1") return { title: "Payment Fee Summary", headers: ["Provider account", "Bearer", "Fee", "Tax", "Total"], rows: preview.report.lines.map((line) => [line.providerAccount, line.bearer, line.amount.minorUnits / 10 ** line.amount.scale, line.tax.minorUnits / 10 ** line.tax.scale, line.total.minorUnits / 10 ** line.total.scale]) }
  if (preview.reportKey === "monthly_owner_report_v1") return { title: "Monthly Owner Report", headers: ["Sales", "Purchase spend", "Payment fees", "Stock movement value", "Stock movement count"], rows: [[preview.report.sales.minorUnits / 10 ** preview.report.sales.scale, preview.report.purchaseSpend.minorUnits / 10 ** preview.report.purchaseSpend.scale, preview.report.paymentFees.minorUnits / 10 ** preview.report.paymentFees.scale, preview.report.stockMovementValue.minorUnits / 10 ** preview.report.stockMovementValue.scale, preview.report.stockMovementCount]] }
  return { title: preview.reportKey, headers: ["Generated at", "Watermark"], rows: [[preview.generatedAt, preview.watermark]] }
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
  const pdf = useReportPdf()
  const createSchedule = useCreateOwnerReportSchedule(organizationId)
  const updateSchedule = useUpdateOwnerReportSchedule()
  const runSchedule = useRunOwnerReportSchedule()
  const recipients = useOwnerReportScheduleRecipients(organizationId)

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
    ReportPreview | null
  >(null)
  const selectedCompanyNumber = Number(selectedCompanyId)
  const schedules = useOwnerReportSchedules(
    organizationId,
    Number.isFinite(selectedCompanyNumber) ? selectedCompanyNumber : undefined,
  )
  const [scheduledReportKey, setScheduledReportKey] = useState<string>("")
  const [scheduledFrequency, setScheduledFrequency] = useState<"daily" | "weekly" | "monthly">("daily")
  const [scheduledHour, setScheduledHour] = useState("8")
  const [scheduledMinute, setScheduledMinute] = useState("0")
  const [scheduledRecipients, setScheduledRecipients] = useState<string[]>([])
  const history = useGeneratedOwnerReportHistory(
    organizationId,
    Number.isFinite(selectedCompanyNumber) ? selectedCompanyNumber : undefined,
  )

  useEffect(() => {
    if (defaultCompanyId && defaultCompanyId > 0) {
      setSelectedCompanyId(String(defaultCompanyId))
    }
  }, [defaultCompanyId])

  useEffect(() => {
    const first = catalog.data?.reports[0]?.key
    if (!scheduledReportKey && first) setScheduledReportKey(first)
  }, [catalog.data?.reports, scheduledReportKey])

  useEffect(() => {
    if (scheduledRecipients.length || !recipients.data) return
    setScheduledRecipients(recipients.data.flatMap((recipient) => [recipient.userIdentity ?? recipient.user_identity].filter(Boolean) as string[]))
  }, [recipients.data, scheduledRecipients.length])

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

  const handlePdf = async () => {
    if (!activePreview) return
    const blob = await pdf.mutateAsync({ reportKey: activePreview.reportKey, companyId: activePreview.scope.companyId, date, timezone })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${activePreview.reportKey}.pdf`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleXlsx = async () => {
    if (!activePreview) return
    const { title, headers, rows } = ownerReportXlsxData(activePreview)
    await downloadPivotTableXlsx(title, headers, rows, `${activePreview.reportKey}.xlsx`)
  }

  const handleCreateSchedule = async () => {
    const companyId = Number(selectedCompanyId)
    if (!Number.isFinite(companyId) || companyId <= 0 || !scheduledReportKey || scheduledRecipients.length === 0) {
      toast({ title: "Choose a report and at least one active recipient", variant: "destructive" })
      return
    }
    const catalogEntry = entries.find((entry) => entry.key === scheduledReportKey)
    await createSchedule.mutateAsync({
      name: `${catalogEntry?.title ?? scheduledReportKey} schedule`,
      companyId,
      reportKey: scheduledReportKey as ReportPreview["reportKey"],
      frequency: scheduledFrequency,
      hour: Math.max(0, Math.min(23, Number(scheduledHour) || 0)),
      minute: Math.max(0, Math.min(59, Number(scheduledMinute) || 0)),
      timezone,
      recipientIdentities: scheduledRecipients,
      nextRun: new Date(Date.now() + 60_000).toISOString(),
      isActive: true,
    })
    await schedules.refetch()
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled delivery</CardTitle>
          <CardDescription>PDF-only delivery creates an in-app notification with the immutable artifact attached.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Field><FieldLabel>Report</FieldLabel><Select value={scheduledReportKey} onValueChange={setScheduledReportKey}><SelectTrigger><SelectValue placeholder="Choose report" /></SelectTrigger><SelectContent>{entries.map((entry) => <SelectItem key={entry.key} value={entry.key}>{entry.title}</SelectItem>)}</SelectContent></Select></Field>
            <Field><FieldLabel>Cadence</FieldLabel><Select value={scheduledFrequency} onValueChange={(value) => setScheduledFrequency(value as "daily" | "weekly" | "monthly")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select></Field>
            <Field><FieldLabel>Hour</FieldLabel><InputGroup><InputGroupInput type="number" min="0" max="23" value={scheduledHour} onChange={(event) => setScheduledHour(event.target.value)} /></InputGroup></Field>
            <Field><FieldLabel>Minute</FieldLabel><InputGroup><InputGroupInput type="number" min="0" max="59" value={scheduledMinute} onChange={(event) => setScheduledMinute(event.target.value)} /></InputGroup></Field>
          </FieldGroup>
          <Field><FieldLabel>Recipients</FieldLabel><div className="flex flex-wrap gap-3 text-sm">{recipients.data?.map((recipient) => { const identity = recipient.userIdentity ?? recipient.user_identity; if (!identity) return null; return <label key={identity} className="flex items-center gap-2"><input type="checkbox" checked={scheduledRecipients.includes(identity)} onChange={(event) => setScheduledRecipients((current) => event.target.checked ? [...current, identity] : current.filter((value) => value !== identity))} />{identity.slice(0, 16)}…</label> })}</div></Field>
          <div><Button onClick={() => void handleCreateSchedule()} disabled={createSchedule.isPending || !scheduledReportKey}>Create schedule</Button></div>
          {(schedules.data?.schedules.length ?? 0) > 0 && <div className="flex flex-col gap-2 text-sm">{schedules.data?.schedules.map((schedule) => <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><span>{schedule.ownerReportKey} · {schedule.frequency} · {String(schedule.hour).padStart(2, "0")}:{String(schedule.minute).padStart(2, "0")} · {schedule.isActive ? "active" : "paused"}</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void updateSchedule.mutateAsync({ scheduleId: schedule.id, input: { isActive: !schedule.isActive } }).then(() => schedules.refetch())}>{schedule.isActive ? "Pause" : "Resume"}</Button><Button size="sm" onClick={() => void runSchedule.mutateAsync(schedule.id).then(() => schedules.refetch())}>Run now</Button></div></div>)}</div>}
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
        <div className="flex flex-col gap-4"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => void handleXlsx()}>XLSX</Button><Button size="sm" onClick={() => void handlePdf()} disabled={pdf.isPending}><Download data-icon="inline-start" />PDF</Button></div><ReportPreviewPanel preview={activePreview} /></div>
      )}

      {!history.isLoading && (history.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generated report history</CardTitle>
            <CardDescription>Immutable render provenance for this company.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {history.data?.slice(0, 10).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded border p-3">
                <span>{item.reportKey} · v{item.schemaVersion}</span>
                <div className="flex items-center gap-3"><span className="text-muted-foreground">{item.generatedAt}</span><a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/reports/history/${item.id}/pdf`}>PDF</a></div>
              </div>
            ))}
          </CardContent>
        </Card>
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

interface ReportPreviewPanelProps { preview: ReportPreview }

function ReportPreviewPanel({ preview }: ReportPreviewPanelProps) {
  const { t } = useTranslation()
  if (preview.reportKey !== "daily_business_summary_v1") {
    return <LedgerReportPreviewPanel preview={preview} />
  }
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
          label={t("reports.ownerReports.scope.localDate")}
          value={preview.scope.localDate}
        />
        <ScopeItem
          label={t("reports.ownerReports.scope.timezone")}
          value={preview.scope.timezone}
        />
        <ScopeItem
          label={t("reports.ownerReports.cutoffLabel")}
          value={preview.scope.cutoffLabel}
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
              cutoff: preview.sourceWatermark.cutoffLabel,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ScopeItem
              label={t("reports.ownerReports.scope.windowStartUtc")}
              value={preview.sourceWatermark.windowStartUtc}
            />
            <ScopeItem
              label={t("reports.ownerReports.scope.windowEndUtc")}
              value={preview.sourceWatermark.windowEndUtc}
            />
          </div>
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

function LedgerReportPreviewPanel({
  preview,
}: {
  preview: Exclude<ReportPreview, { reportKey: "daily_business_summary_v1" }>
}) {
  const { t } = useTranslation()
  if (preview.reportKey === "low_stock_v1") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{t("reports.ownerReports.previewTitle")}</h3>
          <p className="text-sm text-muted-foreground">{preview.reportKey} · v{preview.schemaVersion}</p>
        </div>
        <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("reports.ownerReports.watermarkTitle")}</AlertTitle><AlertDescription>{preview.watermark}</AlertDescription></Alert>
        <LowStockReportCard report={preview.report} />
        <ReportMetadata preview={preview} />
      </div>
    )
  }
  if (preview.reportKey === "stock_movement_v1") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{t("reports.ownerReports.previewTitle")}</h3>
          <p className="text-sm text-muted-foreground">{preview.reportKey} · v{preview.schemaVersion}</p>
        </div>
        <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("reports.ownerReports.watermarkTitle")}</AlertTitle><AlertDescription>{preview.watermark}</AlertDescription></Alert>
        <StockMovementReportCard report={preview.report} />
        <ReportMetadata preview={preview} />
      </div>
    )
  }
  if (preview.reportKey === "sales_by_product_v1" || preview.reportKey === "purchase_spend_v1" || preview.reportKey === "payment_fee_summary_v1" || preview.reportKey === "monthly_owner_report_v1") {
    const values = preview.reportKey === "sales_by_product_v1" ? [["Gross sales", formatMoney(preview.report.grossSales)], ["Net sales", formatMoney(preview.report.netSales)], ["Margin", formatMoney(preview.report.margin)]] : preview.reportKey === "purchase_spend_v1" ? [["Purchase spend", formatMoney(preview.report.totalSpend)], ["Quantity purchased", preview.report.quantityPurchased.toLocaleString()]] : preview.reportKey === "payment_fee_summary_v1" ? [["Fee groups", String(preview.report.feeCount)], ["Total fees", formatMoney(preview.report.total)]] : [["Sales", formatMoney(preview.report.sales)], ["Purchase spend", formatMoney(preview.report.purchaseSpend)], ["Payment fees", formatMoney(preview.report.paymentFees)], ["Stock movement", formatMoney(preview.report.stockMovementValue)]]
    return <div className="flex flex-col gap-6"><div><h3 className="text-lg font-semibold tracking-tight">{t("reports.ownerReports.previewTitle")}</h3><p className="text-sm text-muted-foreground">{preview.reportKey} · v{preview.schemaVersion}</p></div><Alert variant="destructive"><AlertCircle /><AlertTitle>{t("reports.ownerReports.watermarkTitle")}</AlertTitle><AlertDescription>{preview.watermark}</AlertDescription></Alert><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{values.map(([label, value]) => <StatCard key={label} label={label} value={value} />)}</div><ReportMetadata preview={preview} /></div>
  }
  const isCash = preview.reportKey === "cash_mobile_money_v1"
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{t("reports.ownerReports.previewTitle")}</h3>
        <p className="text-sm text-muted-foreground">{preview.reportKey} · v{preview.schemaVersion}</p>
      </div>
      <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("reports.ownerReports.watermarkTitle")}</AlertTitle><AlertDescription>{preview.watermark}</AlertDescription></Alert>
      {preview.reportKey === "cash_mobile_money_v1" ? (
        <CashReportStats report={preview.report} />
      ) : preview.reportKey === "customer_balances_v1" ? (
        <CustomerBalanceStats report={preview.report} />
      ) : (
        <SupplierPayablesStats report={preview.report} />
      )}
      {preview.reportKey === "cash_mobile_money_v1" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Providers</CardTitle>
              <CardDescription>Receipts, disbursements, and fees grouped by provider.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {preview.report.providers.map((provider) => (
                <div key={provider.provider} className="flex justify-between gap-4 rounded border p-3">
                  <span>{provider.provider}</span>
                  <span>{formatMoney(provider.net)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unreconciled</CardTitle>
              <CardDescription>{preview.report.unreconciled.count} posted payment(s) without allocation.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {preview.report.unreconciled.lines.length === 0 ? (
                <p className="text-muted-foreground">No unreconciled posted payments as of the cutoff.</p>
              ) : (
                preview.report.unreconciled.lines.map((line) => (
                  <div key={line.paymentTransactionId} className="flex justify-between gap-4 rounded border p-3">
                    <span>{line.referenceMasked ?? `Txn #${line.paymentTransactionId}`}</span>
                    <span>{formatMoney(line.amount)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
      {preview.reportKey !== "cash_mobile_money_v1" && preview.report.dueBuckets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Due buckets</CardTitle>
            <CardDescription>Aging by invoice due date as of the report date.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {preview.report.dueBuckets.map((bucket) => (
              <div key={bucket.bucket} className="flex justify-between gap-4 rounded border p-3">
                <span>{bucket.label}</span>
                <span>{formatMoney(bucket.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">{isCash ? "Accounts" : "Open items"}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {preview.reportKey === "cash_mobile_money_v1"
            ? preview.report.accounts.map((line) => (
                <div key={line.paymentAccountId} className="flex justify-between gap-4 rounded border p-3">
                  <span>{line.name} · {line.provider}</span>
                  <span>{formatMoney(line.closing)}</span>
                </div>
              ))
            : preview.report.lines.map((line) => (
                <div key={line.moveId} className="flex flex-col gap-1 rounded border p-3">
                  <div className="flex justify-between gap-4">
                    <span>{line.partnerDisplayName ?? `Partner #${line.partnerId ?? "-"}`}</span>
                    <span>{formatMoney(line.residual)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {line.dueDate ? <span>Due {line.dueDate}</span> : null}
                    <span>Original {formatMoney(line.originalAmount)}</span>
                    <span>Paid {formatMoney(line.paidAmount)}</span>
                    {line.isPartial ? <span>Partial</span> : null}
                    {line.lastPaymentDate ? <span>Last payment {line.lastPaymentDate}</span> : null}
                  </div>
                </div>
              ))}
        </CardContent>
      </Card>
      <ReportMetadata preview={preview} />
    </div>
  )
}

function LowStockReportCard({ report }: { report: LowStockReportV1 }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Low-stock alerts</CardTitle>
        <CardDescription>{report.alertCount} products need replenishment attention.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {report.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No low-stock alerts in the current snapshot.</p>
        ) : report.lines.map((line) => (
          <div key={line.productId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="font-medium">{line.name}</p>
              <p className="text-sm text-muted-foreground">{line.sku ?? `Product ${line.productId}`} · {line.supplierHint}</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={line.available <= 0 ? "destructive" : "secondary"}>Available {line.available}</Badge>
              <span className="text-muted-foreground">Reorder {line.reorderPoint}</span>
              {line.outdatedQuant ? <Badge variant="outline">Outdated count</Badge> : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function StockMovementReportCard({ report }: { report: StockMovementReportV1 }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Completed moves" value={String(report.movementCount)} />
        <StatCard label="Quantity moved" value={report.quantityMoved.toLocaleString()} />
        <StatCard label="Valuation reference" value={formatMoney(report.valuationReference)} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Movement detail</CardTitle>
          <CardDescription>Newest completed moves in the selected local-day window.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {report.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed stock movements in this window.</p>
          ) : report.lines.map((line) => (
            <div key={line.moveId} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{line.productName}</p>
                <p className="text-sm text-muted-foreground">{line.sku ?? `Product ${line.productId}`} · {line.sourceLocation} → {line.destinationLocation}</p>
                <p className="text-xs text-muted-foreground">{line.reference ?? `Move #${line.moveId}`} · {line.movedAt ?? "Completed date unavailable"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">Qty {line.quantity.toLocaleString()}</Badge>
                <span className="text-muted-foreground">Value {formatMoney(line.valuationReference)}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function CashReportStats({ report }: { report: Extract<ReportPreview, { reportKey: "cash_mobile_money_v1" }>['report'] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {([['Opening', report.opening], ['Receipts', report.receipts], ['Disbursements', report.disbursements], ['Fees', report.fees], ['Closing', report.closing]] satisfies Array<[string, MoneyAmount]>).map(([label, value]) => (
        <StatCard key={label} label={label} value={formatMoney(value)} />
      ))}
    </div>
  )
}

function CustomerBalanceStats({
  report,
}: {
  report: Extract<ReportPreview, { reportKey: "customer_balances_v1" }>["report"]
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([['Open', report.totalOpen], ['Overdue', report.overdue], ['Current', report.current]] satisfies Array<[string, MoneyAmount]>).map(
          ([label, value]) => (
            <StatCard key={label} label={label} value={formatMoney(value)} />
          ),
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {([['Within limit', report.creditStatus.withinLimit], ['Over limit', report.creditStatus.overLimit], ['Unknown', report.creditStatus.unknown]] satisfies Array<[string, number]>).map(
          ([label, value]) => (
            <StatCard key={label} label={label} value={String(value)} />
          ),
        )}
      </div>
    </div>
  )
}

function SupplierPayablesStats({
  report,
}: {
  report: Extract<ReportPreview, { reportKey: "supplier_payables_v1" }>["report"]
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {([['Open', report.totalOpen], ['Overdue', report.overdue], ['Current', report.current], ['Paid', report.paidAmounts], ['Planned', report.plannedAmounts]] satisfies Array<[string, MoneyAmount]>).map(
        ([label, value]) => (
          <StatCard key={label} label={label} value={formatMoney(value)} />
        ),
      )}
    </div>
  )
}

function ReportMetadata({ preview }: { preview: ReportPreview }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("reports.ownerReports.sourceWatermarkTitle")}</CardTitle>
        <CardDescription>
          {t("reports.ownerReports.sourceWatermarkCutoff", {
            cutoff: preview.sourceWatermark.cutoffLabel,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ScopeItem
            label={t("reports.ownerReports.scope.windowStartUtc")}
            value={preview.sourceWatermark.windowStartUtc}
          />
          <ScopeItem
            label={t("reports.ownerReports.scope.windowEndUtc")}
            value={preview.sourceWatermark.windowEndUtc}
          />
        </div>
        <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground">
          {preview.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
