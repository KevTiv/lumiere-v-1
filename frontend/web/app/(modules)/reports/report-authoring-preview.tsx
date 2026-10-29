"use client"

import { useMemo, useSyncExternalStore } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Badge } from "@lumiere/ui/components/badge"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@lumiere/ui/components/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@lumiere/ui/components/table"
import { Separator } from "@lumiere/ui/components/separator"
import { StoredDashboardView } from "@lumiere/ui/pages/stored-dashboard-view"
import type { StoredDashboardDataSources } from "@lumiere/ui/lib/stored-dashboard-resolver"
import { toCreateDashboardWidgetParams } from "@lumiere/erp-shared/reports-dashboard-params"
import { useStoredDashboardDataSources } from "@/hooks/use-stored-dashboard-data-sources"
import { toCreateDashboardWidgetPayload } from "@/lib/reports-module-form-payloads"
import { authoringOptionLabel, reportAuthoringKind, scheduleAuthoringPreview, scopeWidgetPreviewRows, templatePageGeometry } from "./report-authoring-model"

const subscribeTimeZone = () => () => undefined
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const serverTimeZone = () => "UTC"

interface ReportAuthoringPreviewProps {
  values: FormValues
  config: FormConfig
  organizationId: bigint
  companyLabel?: string
}


export function ReportAuthoringPreview({ values, config, organizationId, companyLabel }: ReportAuthoringPreviewProps) {
  const { t } = useTranslation()
  const kind = reportAuthoringKind(config.id)
  if (!kind) return null
  const title = String(values.name ?? "").trim() || config.title
  const hasCompanyField = config.sections.some((section) => section.fields.some((field) => field.name === "companyId"))
  const selectedCompany = hasCompanyField ? authoringOptionLabel(config, "companyId", values.companyId) : companyLabel

  return (
    <Card data-testid={`report-authoring-preview-${kind}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("reports.authoring.preview", { defaultValue: "Preview" })}</CardTitle>
          <Badge variant="outline">{t("reports.authoring.unsaved", { defaultValue: "Unsaved" })}</Badge>
        </div>
        <CardDescription>{selectedCompany || t("reports.authoring.companyRequired", { defaultValue: "Select a company to preview its data." })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {kind === "report" ? <FinancialReportSheet values={values} config={config} title={title} /> : null}
        {kind === "template" ? <TemplateSheet values={values} title={title} /> : null}
        {kind === "schedule" ? <ScheduleSheet values={values} config={config} title={title} /> : null}
        {kind === "dashboard" ? (
          <>
            <div className="flex flex-col gap-1"><h3>{title}</h3><p className="text-sm text-muted-foreground">{String(values.description ?? "")}</p></div>
            <div className="grid grid-cols-3 gap-2" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-16 rounded-md border border-dashed border-border bg-muted/20" />)}
            </div>
            <Empty className="border"><EmptyHeader><EmptyTitle>{t("reports.authoring.emptyDashboard", { defaultValue: "Start with an empty dashboard" })}</EmptyTitle><EmptyDescription>{t("reports.authoring.dashboardNext", { defaultValue: "Save the dashboard, then use Add widget to choose and arrange its content." })}</EmptyDescription></EmptyHeader></Empty>
          </>
        ) : null}
        {kind === "widget" ? <WidgetAuthoringPreview values={values} organizationId={organizationId} title={title} /> : null}
      </CardContent>
      <CardFooter><p className="text-xs text-muted-foreground">{t("reports.authoring.notSaved", { defaultValue: "Changes in this preview are not saved until you submit." })}</p></CardFooter>
    </Card>
  )
}

function FinancialReportSheet({ values, config, title }: { values: FormValues; config: FormConfig; title: string }) {
  const { t } = useTranslation()
  const type = String(values.reportType ?? "trialBalance")
  const rows = type === "profitAndLoss"
    ? [t("reports.authoring.income", { defaultValue: "Income" }), t("reports.authoring.expenses", { defaultValue: "Expenses" })]
    : type === "balanceSheet"
      ? [t("reports.authoring.assets", { defaultValue: "Assets" }), t("reports.authoring.liabilities", { defaultValue: "Liabilities" }), t("reports.authoring.equity", { defaultValue: "Equity" })]
      : [t("reports.authoring.accountRows", { defaultValue: "Account rows" })]
  const comparison = values.comparisonMode && values.comparisonMode !== "none"
  return (
    <div className="flex flex-col gap-4 rounded-md border bg-background p-4" data-testid="report-sheet-preview">
      <div className="flex flex-col gap-1"><h3>{title}</h3><p className="text-sm text-muted-foreground">{authoringOptionLabel(config, "reportType", type)}</p><p className="text-sm">{String(values.dateFrom || "—")} — {String(values.dateTo || "—")}</p></div>
      <Separator />
      <Table>
        <TableHeader><TableRow><TableHead>{t("reports.authoring.account", { defaultValue: "Account" })}</TableHead>{values.showDebitCredit ? <><TableHead>{t("reports.authoring.debit", { defaultValue: "Debit" })}</TableHead><TableHead>{t("reports.authoring.credit", { defaultValue: "Credit" })}</TableHead></> : <TableHead>{t("reports.authoring.balance", { defaultValue: "Balance" })}</TableHead>}{comparison ? <TableHead>{authoringOptionLabel(config, "comparisonMode", values.comparisonMode)}</TableHead> : null}{values.showPercentage ? <TableHead>%</TableHead> : null}</TableRow></TableHeader>
        <TableBody>{rows.map((row) => <TableRow key={row}><TableCell>{row}</TableCell><TableCell>—</TableCell>{values.showDebitCredit ? <TableCell>—</TableCell> : null}{comparison ? <TableCell>—</TableCell> : null}{values.showPercentage ? <TableCell>—</TableCell> : null}</TableRow>)}</TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t("reports.authoring.structureOnly", { defaultValue: "Layout preview only. Financial amounts are calculated by the report service after generation." })}</p>
      <Badge variant="secondary">{authoringOptionLabel(config, "targetMove", values.targetMove)}</Badge>
    </div>
  )
}

function TemplateSheet({ values, title }: { values: FormValues; title: string }) {
  const { t } = useTranslation()
  const page = templatePageGeometry(values)
  return (
    <>
      <p className="text-xs text-muted-foreground">{t("reports.authoring.pageReference", { defaultValue: "Page layout using an A4 reference. The template body is configured after creation." })}</p>
      {!page.fits ? <Alert variant="destructive"><AlertDescription>{t("reports.authoring.invalidMargins", { defaultValue: "The margins leave no printable area in this preview." })}</AlertDescription></Alert> : null}
      <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-sm border bg-background" style={{ aspectRatio: `${page.pageWidth} / ${page.pageHeight}` }} data-testid="template-page-preview">
        {page.fits ? <div className="absolute flex flex-col justify-between gap-4 border border-dashed border-border p-3" style={{ top: `${page.top / page.pageHeight * 100}%`, bottom: `${page.bottom / page.pageHeight * 100}%`, left: `${page.left / page.pageWidth * 100}%`, right: `${page.right / page.pageWidth * 100}%` }}>
          <div className="flex flex-col gap-3"><h3 className="break-words">{title}</h3>{values.headerLine ? <Separator /> : null}<p className="text-sm text-muted-foreground">{t("reports.authoring.reportContent", { defaultValue: "Report content" })}</p><div className="flex flex-col gap-3" aria-hidden="true">{["w-full", "w-4/5", "w-full", "w-3/5"].map((width, index) => <div key={index} className={`h-2 rounded bg-muted ${width}`} />)}</div></div>
          <div className="flex flex-col gap-2">{values.footerLine ? <Separator /> : null}<p className="text-xs text-muted-foreground">{String(values.reportType ?? t("documents.forms.newDocument.fields.options.pdf"))} · 1</p></div>
        </div> : null}
      </div>
    </>
  )
}

function ScheduleSheet({ values, config, title }: { values: FormValues; config: FormConfig; title: string }) {
  const { t } = useTranslation()
  const preview = scheduleAuthoringPreview(values)
  const timeZone = useSyncExternalStore(subscribeTimeZone, browserTimeZone, serverTimeZone)
  return (
    <>
      <h3>{title}</h3>
      <Badge variant={preview.active ? "secondary" : "outline"}>{preview.active ? t("reports.authoring.active", { defaultValue: "Active schedule" }) : t("reports.authoring.paused", { defaultValue: "Paused schedule" })}</Badge>
      <p>{authoringOptionLabel(config, "reportTemplateId", values.reportTemplateId) || t("reports.authoring.chooseTemplate", { defaultValue: "Choose a report template." })}</p>
      <div className="flex flex-col gap-2 rounded-md border p-4"><p className="text-sm text-muted-foreground">{t("reports.authoring.nextRun", { defaultValue: "Selected next run" })}</p><p data-testid="schedule-next-run-preview">{preview.nextRun ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(preview.nextRun) : "—"}</p><p className="text-xs text-muted-foreground">{timeZone} · {authoringOptionLabel(config, "frequency", values.frequency)}</p></div>
      <Separator />
      <p className="text-sm">{t("reports.authoring.delivery", { defaultValue: "Delivery" })} · {String(values.attachmentFormat ?? t("documents.forms.newDocument.fields.options.pdf"))}</p>
      {preview.recipients.length ? <ul className="flex flex-col gap-1 text-sm">{preview.recipients.map((recipient, index) => <li key={`${recipient}-${index}`} className="break-all">{recipient}</li>)}</ul> : <p className="text-sm text-muted-foreground">{t("reports.authoring.addRecipients", { defaultValue: "Add recipients to preview the delivery list." })}</p>}
      <p className="text-xs text-muted-foreground">{t("reports.authoring.scheduleLimit", { defaultValue: "The selected datetime uses your browser time zone. Future run dates depend on the scheduler." })}</p>
    </>
  )
}

function WidgetAuthoringPreview({ values, organizationId, title }: { values: FormValues; organizationId: bigint; title: string }) {
  const { t } = useTranslation()
  const companyId = String(values.companyId ?? "").trim()
  const model = String(values.dataSource ?? "").trim()
  const models = useMemo(() => companyId && model ? [model] : [], [companyId, model])
  const { dataSources, sourceStates } = useStoredDashboardDataSources(organizationId, models)
  const scopedSources = useMemo((): StoredDashboardDataSources => Object.fromEntries(Object.entries(dataSources).map(([key, rows]) => [key, scopeWidgetPreviewRows(rows, organizationId, companyId)])), [dataSources, organizationId, companyId])
  if (!companyId || !model) return <Empty className="border"><EmptyHeader><EmptyTitle>{t("reports.authoring.chooseSource", { defaultValue: "Choose a company and data source" })}</EmptyTitle><EmptyDescription>{t("reports.authoring.liveWidget", { defaultValue: "The widget preview uses records you can read for the selected company." })}</EmptyDescription></EmptyHeader></Empty>
  const params = toCreateDashboardWidgetParams(toCreateDashboardWidgetPayload(values))
  const widget = { ...params, id: 1, name: title, width: 12 }
  return (
    <>
      <Badge variant="secondary">{t("reports.authoring.recordCount", { defaultValue: "Number of records" })}</Badge>
      <StoredDashboardView dashboard={{ id: "draft", name: title, companyId, widgetIds: [1] }} widgets={[widget]} dataSources={scopedSources} sourceStates={sourceStates} testId="widget-authoring-live-preview" />
      <p className="text-xs text-muted-foreground">{t("reports.authoring.widgetScope", { defaultValue: "Read-only preview of the selected company. The saved widget is added to a dashboard separately." })}</p>
    </>
  )
}
