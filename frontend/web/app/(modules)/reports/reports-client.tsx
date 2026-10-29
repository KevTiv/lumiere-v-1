"use client"
import { useCurrencyFormat } from "@lumiere/ui"
import { mergeModuleStates, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { applyPeriodReportFormContext, periodReportContextState, periodReportFormDefaults, readPeriodReportContext, reportMatchesPeriodContext } from "@lumiere/ui/lib/period-report-context"
import { ModuleInsights } from "../../../components/module-insights"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { templateEditorForm } from "./template-editor-config"
import { TemplateLayoutPreview } from "./template-layout-editor"
import { currentReportTemplate, reportTemplateEditValues, type ReportTemplateEditValues } from "@lumiere/query-hooks/hooks/report-template-effect"
import { toast } from "sonner"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  newFinancialReportForm,
  newReportTemplateForm,
  newScheduledReportForm,
  newAnalyticsMetricForm,
  newTrialBalanceEntryForm,
  updateMetricValuesForm,
  recordScheduledRunForm,
  newDashboardForm,
  newDashboardWidgetForm,
  addWidgetToDashboardForm,
  updateWidgetLayoutForm,
  shareDashboardForm,
  updateFinancialReportForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  mergeFieldDefaultValues,
  StoredDashboardView,
  widgetModelsForDashboard,
  resolveStoredDashboard,
  storedDashboardExportGate,
  exportDashboardToPng,
  reportExportSourceProvenance,
  timeRangeToMs,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  financialReportsTableConfig,
  reportTemplatesTableConfig,
  analyticsMetricsTableConfig,
  trialBalancesTableConfig,
  scheduledReportsTableConfig,
  dashboardsTableConfig,
  dashboardWidgetsTableConfig,
  csvImportForm,
} from "@lumiere/ui"
import { EntityLabelsProvider, labelsFromRows } from "@lumiere/ui"
import type { EntityTableConfig, EntityViewConfig, FormConfig } from "@lumiere/ui"
import type { FormValues } from "@lumiere/ui/lib/form-types"
import { reportsModuleConfig } from "@/lib/module-dashboard-configs"
import { useReportsModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useFinancialReports,
  useTrialBalances,
  useReportTemplates,
  useScheduledReports,
  useAnalyticsMetrics,
  useCreateFinancialReportFlow,
  useGenerateFinancialReport,
  useExportFinancialReport,
  useArchiveFinancialReport,
  useDeleteFinancialReport,
  useCreateReportTemplate,
  useCreateScheduledReport,
  useCreateAnalyticsMetric,
  useUpdateReportTemplate,
  useUpdateMetricValues,
  useRecordReportRun,
  useCreateTrialBalanceEntry,
  useReportsCsvImportMutations,
  useUpdateFinancialReport,
  useCreateDashboard,
  useCreateDashboardWidget,
  useAddWidgetToDashboard,
  useUpdateWidgetLayout,
  useShareDashboard,
  useDashboards,
  useDashboardWidgets,
} from "@lumiere/query-hooks/hooks/reports"
import type {
  AnalyticsMetric,
  Dashboard,
  DashboardWidget,
  FinancialReport,
  ReportTemplate,
  ScheduledReport,
  TrialBalance,
} from "@lumiere/query-hooks/hooks/reports"
import { toCreateTrialBalanceEntryParams } from "@lumiere/erp-shared/reports-create-params"
import {
  toCreateAnalyticsMetricPayload,
  toCreateDashboardPayload,
  toCreateDashboardWidgetPayload,
  toCreateFinancialReportPayload,
  toCreateReportTemplatePayload,
  toCreateScheduledReportPayload,
  toUpdateFinancialReportFormPayload,
} from "@/lib/reports-module-form-payloads"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import {
  useAccountAccounts,
  useAccountMoveLines,
  useAccountMoves,
  useAccountPayments,
} from "@lumiere/query-hooks/hooks/accounting"
import { currencyCodeMap } from "@lumiere/ui/lib/kpi-tiles"
import { type ChartValueFormat } from "@lumiere/ui/lib/chart-format"
import { singleCurrencyId } from "../accounting/accounting-dashboard-charts"
import { expenseBreakdown, profitAndLossByMonth } from "./finance-dashboard-charts"
import { useAccountPeriods } from "@lumiere/query-hooks/hooks/accounting/fiscal-periods"
import { useStoredDashboardDataSources } from "@/hooks/use-stored-dashboard-data-sources"
import {
  companyRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
  currencyOptionsFromRows,
  financialReportRowsToSelectOptions,
} from "@/lib/form-lookup"
import {
  Archive,
  FileDown,
  FileSpreadsheet,
  FileText,
  Trash2,
  RefreshCw,
  Pencil,
  Gauge,
  PlayCircle,
  Upload,
  Share2,
  Plus,
  Grid3X3,
  Eye,
  Download,
  Sparkles,
} from "lucide-react"
import { buildEntitySelection } from "@lumiere/query-hooks/ai-ui-context"
import { useOpenErpAiChat } from "@/lib/erp-ai-context"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PivotExplorer } from "./pivot-explorer"
import { VatReportPanel } from "./vat-report-panel"
import { StatementsPanel } from "./statements-panel"
import { QueryBuilder, type QueryBuilderStatus } from "./query-builder"
import { OwnerReportsPanel } from "./owner-reports-panel"
import { ReportPeriodNotice } from "./report-period-notice"
import { useRBAC } from "@/lib/rbac-context"
import { ReportAuthoringPreview } from "./report-authoring-preview"
import { reportAuthoringKind, enhanceWidgetAuthoringForm } from "./report-authoring-model"
import { enhanceMetricForm } from "./metric-authoring"
import { MetricAuthoringPreview } from "./metric-authoring-preview"
import { EntityView } from "@lumiere/ui/entity-views/entity-view"
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { ReportStart, ReportResult } from "./report-workspace"
import { reportWorkspaceHref, scopedReports, selectedReport, reportCanDownload, reportTag } from "./report-workspace-model"
import { statementKindForReportType } from "@lumiere/query-hooks/hooks/read-ui-rows"
import { formatStatementAmount } from "./statement-tree"

export { REPORTS_UI_REDUCERS } from "@/lib/reports-ui-reducers"

type DashboardRecord = { [key: string]: unknown }

interface ReportsClientProps {
  initialReports?: FinancialReport[]
  initialBalances?: TrialBalance[]
  initialReportTemplates?: ReportTemplate[]
  initialScheduledReports?: ScheduledReport[]
  initialAnalyticsMetrics?: AnalyticsMetric[]
  initialDashboards?: Dashboard[]
  initialDashboardWidgets?: DashboardWidget[]
  organizationId?: number
}

type ReportsClientLoadedProps = Omit<ReportsClientProps, "organizationId"> & {
  organizationId: number
}

export function ReportsClient(props: ReportsClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <ReportsClientLoaded {...props} organizationId={props.organizationId} />
}

function ReportsClientLoaded({
  initialReports,
  initialBalances,
  initialReportTemplates,
  initialScheduledReports,
  initialAnalyticsMetrics,
  initialDashboards,
  initialDashboardWidgets,
  organizationId,
}: ReportsClientLoadedProps) {
  useReportsModuleSubscription()
  const router = useRouter()
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => reportsModuleConfig(t), [t])
  /** BigInt organization id for React Query keys (matches `@lumiere/query-hooks` `organizationId` param). */
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId)
  const { currentUser, checkPermission, permissionsReady } = useRBAC()
  const searchParams = useSearchParams()
  const periodRequested = searchParams?.get("source") === "period-close"
  const periodContext = useMemo(() => readPeriodReportContext(searchParams ?? new URLSearchParams()), [searchParams])
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string; reportType?: string } | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [editTemplateOpen, setEditTemplateOpen] = useState(false)
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null)
  const [editTemplateInitial, setEditTemplateInitial] = useState<ReportTemplateEditValues | null>(null)
  const [metricValuesOpen, setMetricValuesOpen] = useState(false)
  const [metricValuesId, setMetricValuesId] = useState<string | null>(null)
  const [recordRunOpen, setRecordRunOpen] = useState(false)
  const [recordRunScheduledId, setRecordRunScheduledId] = useState<string | null>(null)
  const [csvKind, setCsvKind] = useState<"report_template" | "analytics_metric" | null>(null)
  useEffect(() => { setSelectedReportId(null); setQuickActionForm(null) }, [orgId, operatingCompanyId, currentUser?.id, periodContext?.periodId, periodContext?.reportType, periodContext?.dateFrom, periodContext?.dateTo])

  // Dashboard modal states
  const [editReportOpen, setEditReportOpen] = useState(false)
  const [editReportId, setEditReportId] = useState<string | null>(null)
  const [createDashboardOpen, setCreateDashboardOpen] = useState(false)
  const [createWidgetOpen, setCreateWidgetOpen] = useState(false)
  const [addWidgetOpen, setAddWidgetOpen] = useState(false)
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null)
  const [shareDashboardOpen, setShareDashboardOpen] = useState(false)
  const [shareDashboardId, setShareDashboardId] = useState<string | null>(null)
  const [updateLayoutOpen, setUpdateLayoutOpen] = useState(false)
  const [updateLayoutWidgetId, setUpdateLayoutWidgetId] = useState<string | null>(null)
  const [viewDashboardId, setViewDashboardId] = useState<string | null>(null)
  const [viewDashboardRange, setViewDashboardRange] = useState<"all" | "7d" | "30d" | "90d" | "ytd">("all")
  const [queryBuilderStatus, setQueryBuilderStatus] = useState<QueryBuilderStatus | null>(null)
  const openErpAiChat = useOpenErpAiChat()
  const handleStoredDashboardDrill = useCallback(
    (target: { href: string }) => router.push(target.href),
    [router],
  )

  const reportsQuery = useFinancialReports(orgId, initialReports)
  const { data: reportsRaw = [] } = reportsQuery
  const trialBalancesQuery = useTrialBalances(orgId, initialBalances)
  const { data: trialBalances = [] } = trialBalancesQuery
  const periodsQuery = useAccountPeriods(orgId, { enabled: periodRequested })
  const reportTemplatesQuery = useReportTemplates(orgId, initialReportTemplates)
  const { data: reportTemplates = [] } = reportTemplatesQuery
  const scheduledReportsQuery = useScheduledReports(orgId, initialScheduledReports)
  const { data: scheduledReports = [] } = scheduledReportsQuery
  const analyticsMetricsQuery = useAnalyticsMetrics(orgId, initialAnalyticsMetrics)
  const { data: analyticsMetrics = [] } = analyticsMetricsQuery
  const dashboardsQuery = useDashboards(orgId, initialDashboards)
  const { data: dashboards = [] } = dashboardsQuery
  const dashboardWidgetsQuery = useDashboardWidgets(orgId, initialDashboardWidgets)
  const { data: dashboardWidgets = [] } = dashboardWidgetsQuery
  const { data: companies = [] } = useCompanies(organizationId, organizationId > 0)
  const accountAccountsQuery = useAccountAccounts(orgId)
  const { data: accountAccounts = [] } = accountAccountsQuery
  const currenciesQuery = useCurrencies()
  const { data: currencies = [] } = currenciesQuery
  const periodState = periodReportContextState(periodContext, { organizationId: orgId, companyId: operatingCompanyId, periods: periodsQuery.data ?? [], periodState: moduleQueryState(periodsQuery), reportState: moduleQueryState(reportsQuery) })
  const validPeriodContext = periodRequested && periodState.status === "ready" ? periodContext : null
  const accountMovesQuery = useAccountMoves(orgId, { enabled: organizationId > 0 })
  const { data: accountMoves = [] } = accountMovesQuery
  const accountMoveLinesQuery = useAccountMoveLines(orgId, { enabled: organizationId > 0 })
  const { data: accountMoveLines = [] } = accountMoveLinesQuery
  const { data: accountPayments = [] } = useAccountPayments(orgId, { enabled: organizationId > 0 })

  const entityLabels = useMemo(() => ({ reportTemplateId: labelsFromRows(reportTemplates) }), [reportTemplates])

  const reports = useMemo(
    () =>
      scopedReports(reportsRaw, orgId, operatingCompanyId).filter((report) => !periodRequested || Boolean(validPeriodContext && reportMatchesPeriodContext(report, validPeriodContext))).map((r) => ({
        ...r,
        state: reportTag(r.state),
      })),
    [reportsRaw, periodRequested, validPeriodContext, orgId, operatingCompanyId],
  )

  const openReport = useCallback((id: string) => {
    router.push(reportWorkspaceHref(searchParams?.toString() ?? "", id), { scroll: false })
  }, [router, searchParams])
  const routeReportId = searchParams?.get("report") ?? null
  const openedReport = selectedReport(reports, routeReportId)
  const [reportActionError, setReportActionError] = useState<string | null>(null)
  useEffect(() => setReportActionError(null), [routeReportId, operatingCompanyId, orgId, currentUser?.id])

  const createTrialBalanceEntry = useCreateTrialBalanceEntry(orgId, operatingCompanyId)
  const reportActionScope = `${orgId}:${operatingCompanyId}:${currentUser?.id ?? ""}:${periodContext?.periodId ?? "all"}:${periodContext?.reportType ?? "all"}:${periodContext?.dateFrom ?? ""}:${periodContext?.dateTo ?? ""}`
  const reportActionLive = useRef({ scope: reportActionScope, allowed: true })
  useEffect(() => () => { reportActionLive.current.allowed = false }, [])
  reportActionLive.current = { scope: reportActionScope, allowed: permissionsReady !== false && Boolean(currentUser?.id) && checkPermission("financial_report", "create").allowed && checkPermission("financial_report", "write").allowed && moduleQueryState(reportsQuery).status === "ready" && (!periodRequested || periodState.status === "ready") }
  const createFinancialReportFlow = useCreateFinancialReportFlow(orgId, operatingCompanyId, { scopeKey: reportActionScope, mayDispatch: () => reportActionLive.current.scope === reportActionScope && reportActionLive.current.allowed })
  const generateFinancialReport = useGenerateFinancialReport(orgId, operatingCompanyId)
  const exportFinancialReport = useExportFinancialReport(orgId, operatingCompanyId)
  const archiveFinancialReport = useArchiveFinancialReport(orgId, operatingCompanyId)
  const deleteFinancialReport = useDeleteFinancialReport(orgId, operatingCompanyId)
  const createReportTemplate = useCreateReportTemplate(orgId)
  const createScheduledReport = useCreateScheduledReport(orgId)
  const createAnalyticsMetric = useCreateAnalyticsMetric(orgId)
  const updateReportTemplate = useUpdateReportTemplate(orgId, operatingCompanyId)
  const updateMetricValues = useUpdateMetricValues(orgId, operatingCompanyId)
  const recordReportRun = useRecordReportRun(orgId)
  const csvImports = useReportsCsvImportMutations(orgId)
  const importReportTemplateCsv = csvImports.importReportTemplate
  const importAnalyticsMetricCsv = csvImports.importAnalyticsMetric

  // Dashboard hooks (6 missing reducers)
  const updateFinancialReport = useUpdateFinancialReport(orgId, operatingCompanyId)
  const createDashboard = useCreateDashboard(orgId)
  const createDashboardWidget = useCreateDashboardWidget(orgId)
  const addWidgetToDashboard = useAddWidgetToDashboard(orgId)
  const updateWidgetLayout = useUpdateWidgetLayout(orgId, operatingCompanyId)
  const shareDashboard = useShareDashboard(orgId)

  const templateSelectOptions = useMemo(
    () =>
      reportTemplates.map((row) => ({
        value: String(row.id ?? ""),
        label: String(row.name ?? row.id),
      })),
    [reportTemplates],
  )

  const widgetSelectOptions = useMemo(
    () =>
      dashboardWidgets.map((row) => ({
        value: String(row.id ?? ""),
        label: `${String(row.name ?? row.id)} (id ${String(row.id)})`,
      })),
    [dashboardWidgets],
  )

  const viewDashboard = useMemo(
    () =>
      viewDashboardId == null
        ? null
        : (dashboards.find((row) => String(row.id) === viewDashboardId) as
          | Record<string, unknown>
          | undefined) ?? null,
    [dashboards, viewDashboardId],
  )

  const viewDashboardModels = useMemo(() => {
    if (!viewDashboard) return []
    return widgetModelsForDashboard(
      viewDashboard,
      dashboardWidgets as unknown as DashboardRecord[],
    )
  }, [viewDashboard, dashboardWidgets])

  const {
    dataSources: storedDashboardDataSources,
    sourceStates: storedDashboardSourceStates,
    isLoading: storedDashboardLoading,
    isRefreshing: storedDashboardRefreshing,
    issue: storedDashboardIssue,
    retry: retryStoredDashboard,
  } = useStoredDashboardDataSources(orgId, viewDashboardModels)

  const viewDashboardTimeRange = useMemo(
    () => (viewDashboardRange === "all" ? undefined : timeRangeToMs(viewDashboardRange)),
    [viewDashboardRange],
  )

  const storedDashboardResolution = useMemo(() => {
    if (!viewDashboard) return null
    const widgetIds = (viewDashboard.widgetIds ?? viewDashboard.widget_ids) as
      | Array<bigint | number>
      | undefined
    return resolveStoredDashboard(
      dashboardWidgets as unknown as Record<string, unknown>[],
      widgetIds ?? [],
      storedDashboardDataSources,
      {
        ...(viewDashboardTimeRange ?? {}),
        sourceStates: storedDashboardSourceStates,
        onDrillTarget: handleStoredDashboardDrill,
      },
    )
  }, [viewDashboard, dashboardWidgets, storedDashboardDataSources, storedDashboardSourceStates, viewDashboardTimeRange, handleStoredDashboardDrill, t])

  const storedDashboardExport = useMemo(
    () => storedDashboardResolution
      ? storedDashboardExportGate(storedDashboardResolution)
      : { allowed: false, reason: t("reports.reportsClient.noDashboardSelected") },
    [storedDashboardResolution, t],
  )

  const storedDashboardRef = useRef<HTMLDivElement>(null)
  const storedDashboardProvenance = useMemo(() => {
    if (!viewDashboard) return undefined
    return reportExportSourceProvenance({
      organizationId: orgId,
      companyId: (viewDashboard.companyId ?? viewDashboard.company_id ?? operatingCompanyId ?? "") as string | number | bigint,
      dashboardId: (viewDashboard.id ?? "") as string | number | bigint,
      model: [...viewDashboardModels].sort().join(","),
      domain: JSON.stringify(
        (dashboardWidgets as unknown as Record<string, unknown>[])
          .filter((widget) => ((viewDashboard.widgetIds ?? viewDashboard.widget_ids) as Array<string | number | bigint> | undefined)
            ?.some((id) => String(id) === String(widget.id)))
          .map((widget) => ({ id: String(widget.id ?? ""), domain: widget.domain ?? null })),
      ),
      ...(viewDashboardTimeRange ?? {}),
    })
  }, [dashboardWidgets, operatingCompanyId, orgId, viewDashboard, viewDashboardModels, viewDashboardTimeRange])
  const handleStoredDashboardExport = useCallback(async () => {
    if (!storedDashboardRef.current || !viewDashboard || !storedDashboardExport.allowed) return
    await exportDashboardToPng(
      storedDashboardRef.current,
      String(viewDashboard.name ?? "dashboard"),
      storedDashboardProvenance,
    )
  }, [viewDashboard, storedDashboardExport.allowed, storedDashboardProvenance])

  const addWidgetFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(addWidgetToDashboardForm(t), {
        widgetId: widgetSelectOptions.length > 0
          ? widgetSelectOptions
          : [{ value: "", label: t("reports.forms.addWidgetToDashboard.fields.widgetId"), disabled: true }],
      }),
    [t, widgetSelectOptions],
  )

  const companySelectOptions = useMemo(
    () => companyRowsToSelectOptions(companies as Record<string, unknown>[]),
    [companies],
  )

  const accountSelectOptions = useMemo(
    () => accountAccountRowsToSelectOptions(accountAccounts as Record<string, unknown>[]),
    [accountAccounts],
  )

  const currencySelectOptions = useMemo(
    () => currencyOptionsFromRows(currencies),
    [currencies],
  )

  const financialReportSelectOptions = useMemo(
    () => financialReportRowsToSelectOptions(reports as Record<string, unknown>[]),
    [reports],
  )

  const scheduledReportFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newScheduledReportForm(t), {
          reportTemplateId: templateSelectOptions,
          companyId: companySelectOptions,
        }),
        { companyId: operatingCompanyId != null ? String(operatingCompanyId) : "" },
      ),
    [t, templateSelectOptions, companySelectOptions, operatingCompanyId],
  )

  const financialReportFormConfig = useMemo(
    () => {
      const form = mergeSelectOptionsForFields(newFinancialReportForm(t), {
        currencyId: currencySelectOptions,
      })
      if (!validPeriodContext) return form
      const contextual = mergeFieldDefaultValues(form, periodReportFormDefaults(validPeriodContext))
      return { ...contextual, description: t("reports.forms.generateReport.lockedPeriodHint", { defaultValue: "The report type, dates, and posted-entry basis are fixed by the selected accounting period. Return to period close to choose another period." }), sections: contextual.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ["dateFrom", "dateTo", "reportType", "targetMove"].includes(field.name) ? { ...field, disabled: true } : field) })) }
    },
    [t, currencySelectOptions, validPeriodContext],
  )

  const reportTemplateFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newReportTemplateForm(t), {
          companyId: companySelectOptions,
        }),
        { companyId: operatingCompanyId != null ? String(operatingCompanyId) : "" },
      ),
    [t, companySelectOptions, operatingCompanyId],
  )

  const analyticsMetricFormConfig = useMemo(
    () =>
      enhanceMetricForm(mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newAnalyticsMetricForm(t), {
          companyId: companySelectOptions,
        }),
        { companyId: operatingCompanyId != null ? String(operatingCompanyId) : "" },
      ), t),
    [t, companySelectOptions, operatingCompanyId],
  )

  const dashboardFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newDashboardForm(t), {
          companyId: companySelectOptions,
        }),
        { companyId: operatingCompanyId != null ? String(operatingCompanyId) : "" },
      ),
    [t, companySelectOptions, operatingCompanyId],
  )

  const dashboardWidgetFormConfig = useMemo(
    () =>
      enhanceWidgetAuthoringForm(mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newDashboardWidgetForm(t), {
          companyId: companySelectOptions,
        }),
        { companyId: operatingCompanyId != null ? String(operatingCompanyId) : "" },
      ), t),
    [t, companySelectOptions, operatingCompanyId],
  )

  const trialBalanceEntryFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTrialBalanceEntryForm(t), {
        reportId: financialReportSelectOptions,
        accountId: accountSelectOptions,
        currencyId: currencySelectOptions,
      }),
    [t, financialReportSelectOptions, accountSelectOptions, currencySelectOptions],
  )

  const filteredTrialBalances = useMemo(() => {
    const matchingReportIds = new Set(reports.map((report) => String(report.id)))
    return trialBalances.filter((row) => (!periodRequested || matchingReportIds.has(String(row.reportId))) && (selectedReportId == null || String(row.reportId) === selectedReportId))
  }, [trialBalances, selectedReportId, reports, periodRequested])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    if (csvKind === "report_template") {
      return csvImportForm(t, t("reports.csvImport.templateTitle"))
    }
    return csvImportForm(t, t("reports.csvImport.metricTitle"))
  }, [csvKind, t])

  const financialReportsEntityConfig = useMemo((): EntityViewConfig => {
    const base = financialReportsTableConfig(t)
    const view = base.view as EntityTableConfig
    const columns = view.columns.map((column) => column.key === "name" ? { ...column, render: (_value: unknown, row: EntityRow) => <Button variant="link" className="h-auto max-w-full whitespace-normal p-0 text-left" onClick={(event) => { event.stopPropagation(); openReport(String(row.id)) }}>{String(row.name ?? row.id)}</Button> } : column)
    return {
      ...base,
      view: {
        ...view,
        columns,
        actions: [
          {
            id: "open-report",
            label: t("reports.workspace.open"),
            icon: Eye,
            requiresSelection: true,
            selection: "single",
            onClick: (rows) => { if (rows[0]?.id != null) openReport(String(rows[0].id)) },
          },
          {
            id: "exp-pdf",
            label: t("reports.actions.exportPdf"),
            icon: FileDown,
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some(reportCanDownload),
            successMessage: t("common.actionCompleted", { action: t("reports.actions.exportPdf") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (reportCanDownload(r)) {
                  await exportFinancialReport.mutateAsync({
                    reportId: r.id as string | number | bigint,
                    exportFormat: "pdf",
                  })
                }
              }
            },
          },
          {
            id: "exp-xlsx",
            label: t("reports.actions.exportXlsx"),
            icon: FileSpreadsheet,
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some(reportCanDownload),
            successMessage: t("common.actionCompleted", { action: t("reports.actions.exportXlsx") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (reportCanDownload(r)) {
                  await exportFinancialReport.mutateAsync({
                    reportId: r.id as string | number | bigint,
                    exportFormat: "xlsx",
                  })
                }
              }
            },
          },
          {
            id: "exp-csv",
            label: t("reports.actions.exportCsv"),
            icon: FileText,
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some(reportCanDownload),
            successMessage: t("common.actionCompleted", { action: t("reports.actions.exportCsv") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (reportCanDownload(r)) {
                  await exportFinancialReport.mutateAsync({
                    reportId: r.id as string | number | bigint,
                    exportFormat: "csv",
                  })
                }
              }
            },
          },
          {
            id: "regen",
            label: t("reports.actions.regenerate"),
            icon: RefreshCw,
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => String(row.state) === "draft"),
            successMessage: t("common.actionCompleted", { action: t("reports.actions.regenerate") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (String(r.state) === "draft") {
                  await generateFinancialReport.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "arch",
            label: t("reports.actions.archive"),
            icon: Archive,
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => String(row.state) === "exported"),
            successMessage: t("common.actionCompleted", { action: t("reports.actions.archive") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (String(r.state) === "exported") {
                  await archiveFinancialReport.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "del",
            label: t("reports.actions.delete"),
            icon: Trash2,
            requiresSelection: true,
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) => rows.some((row) => String(row.state) !== "archived"),
            successMessage: t("common.actionCompleted", { action: t("reports.actions.delete") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const st = String(r.state)
                if (st !== "archived") {
                  await deleteFinancialReport.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "edit",
            label: t("reports.actions.edit"),
            icon: Pencil,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              setEditReportId(String(first.id))
              setEditReportOpen(true)
            },
          },
          {
            id: "ask-ai",
            label: t("documents.documentsClient.askAI"),
            icon: Sparkles,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              openErpAiChat({
                selection: buildEntitySelection({
                  activeTab: "reports",
                  entityType: "financial_report",
                  row: first,
                }),
              })
            },
          },
        ],
      },
    }
  }, [
    t,
    exportFinancialReport,
    generateFinancialReport,
    archiveFinancialReport,
    deleteFinancialReport,
    openErpAiChat,
    openReport,
  ])

  const reportTemplatesEntityConfig = useMemo((): EntityViewConfig => {
    const tab = moduleConfig.tabs.find((x) => x.id === "report-templates")
    const base = tab?.entityConfig
    if (!base) return reportTemplatesTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "imp-tpl-csv",
            label: t("reports.toolbar.importTemplateCsv"),
            icon: Upload,
            onClick: (_rows) => setCsvKind("report_template"),
          },
          {
            id: "edit-tpl",
            label: t("reports.actions.editTemplate"),
            icon: Pencil,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              try {
                if (operatingCompanyId == null || operatingCompanyId <= 0n) throw new Error(t("reports.reportsClient.selectACompanyBeforeEditingATemplate"))
                const row = currentReportTemplate(reportTemplates, orgId, operatingCompanyId, BigInt(String(first.id)))
                if (!row) throw new Error(t("reports.reportsClient.reportTemplateIsNoLongerAvailable"))
                setEditTemplateInitial(reportTemplateEditValues(row))
                setEditTemplateId(String(first.id))
                setEditTemplateOpen(true)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t("reports.reportsClient.unableToOpenReportTemplate"))
              }
            },
          },
        ],
      },
    }
  }, [moduleConfig.tabs, t, reportTemplates, orgId, operatingCompanyId])

  const analyticsMetricsEntityConfig = useMemo((): EntityViewConfig => {
    const tab = moduleConfig.tabs.find((x) => x.id === "analytics-metrics")
    const base = tab?.entityConfig
    if (!base) return analyticsMetricsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "imp-metric-csv",
            label: t("reports.toolbar.importMetricCsv"),
            icon: Upload,
            onClick: (_rows) => setCsvKind("analytics_metric"),
          },
          {
            id: "upd-metric",
            label: t("reports.actions.refreshMetric"),
            icon: Gauge,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              setMetricValuesId(String(first.id))
              setMetricValuesOpen(true)
            },
          },
        ],
      },
    }
  }, [moduleConfig.tabs, t])

  const scheduledReportsEntityConfig = useMemo((): EntityViewConfig => {
    const tab = moduleConfig.tabs.find((x) => x.id === "scheduled-reports")
    const base = tab?.entityConfig ?? scheduledReportsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "record-run",
            label: t("reports.actions.recordRun"),
            icon: PlayCircle,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              setRecordRunScheduledId(String(first.id))
              setRecordRunOpen(true)
            },
          },
        ],
      },
    }
  }, [moduleConfig.tabs, t])

  const trialBalanceEntityConfig = useMemo((): EntityViewConfig => {
    const base = trialBalancesTableConfig(t)
    return {
      ...base,
      description: selectedReportId
        ? t("reports.trialBalance.filteredHint", { id: selectedReportId })
        : t("reports.trialBalance.selectReportHint"),
    }
  }, [t, selectedReportId])

  const dashboardsEntityConfig = useMemo((): EntityViewConfig => {
    const base = dashboardsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "view-dashboard",
            label: t("reports.actions.viewDashboard"),
            icon: Eye,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              setViewDashboardId(String(first.id))
            },
          },
          {
            id: "add-widget",
            label: t("reports.actions.addWidget"),
            icon: Plus,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              setSelectedDashboardId(String(first.id))
              setAddWidgetOpen(true)
            },
          },
          {
            id: "share-dashboard",
            label: t("reports.actions.shareDashboard"),
            icon: Share2,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              setShareDashboardId(String(first.id))
              setShareDashboardOpen(true)
            },
          },
        ],
      },
    }
  }, [t])

  const dashboardWidgetsEntityConfig = useMemo((): EntityViewConfig => {
    const base = dashboardWidgetsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "update-layout",
            label: t("reports.actions.updateLayout"),
            icon: Grid3X3,
            requiresSelection: true,
            onClick: (rows) => {
              const first = rows[0]
              if (!first?.id) return
              setUpdateLayoutWidgetId(String(first.id))
              setUpdateLayoutOpen(true)
            },
          },
        ],
      },
    }
  }, [t])

  const { locale } = useCurrencyFormat()
  const reportOutputConfig = useMemo((): EntityViewConfig => {
    const base = trialBalancesTableConfig(t)
    const view = base.view as EntityTableConfig
    const codes = moduleQueryState(currenciesQuery).status === "ready" ? currencyCodeMap(currencies) : new Map<string, string>()
    return { ...base, title: t("reports.workspace.accountTotals"), description: t("reports.workspace.outputHint"), view: { ...view, emptyMessage: t("reports.workspace.emptyOutput"), columns: view.columns.map((column) => column.type === "currency" ? {
      ...column,
      // Never relabel another currency's amounts with the operating-company default.
      render: (value, row) => typeof value === "number" ? formatStatementAmount(value, locale, codes.get(String(row.currencyId ?? row.currency_id))) : "—",
    } : column) } }
  }, [t, locale, currencies, currenciesQuery])
  const liveSections = useMemo(() => {
    const generated = reports.filter((r) => String(r.state) === "generated").length
    const exported = reports.filter((r) => String(r.state) === "exported").length

    const now = new Date()
    const chartSourceState = mergeModuleStates([moduleQueryState(accountAccountsQuery), moduleQueryState(accountMovesQuery), moduleQueryState(accountMoveLinesQuery), moduleQueryState(currenciesQuery)])
    const chartAccounts = accountAccounts.filter((account) => account.companyId === operatingCompanyId)
    const chartLines = accountMoveLines.filter((line) => line.companyId === operatingCompanyId)
    const chartMoves = accountMoves.filter((move) => move.companyId === operatingCompanyId)
    const accountsById = new Map(chartAccounts.map((account) => [String(account.id), account]))
    const companyCurrencyId = singleCurrencyId(chartMoves.map((move) => ({ currencyId: move.companyCurrencyId })))
    const companyCurrencyCode = companyCurrencyId ? currencyCodeMap(currencies).get(companyCurrencyId) : undefined
    const money: ChartValueFormat = companyCurrencyCode ? { kind: "currency", currency: companyCurrencyCode } : { kind: "number" }
    const ninetyDays = 90 * 86_400_000
    const currentWindow = { startMs: now.getTime() - ninetyDays, endMs: now.getTime() }
    const previousWindow = { startMs: now.getTime() - 2 * ninetyDays, endMs: now.getTime() - ninetyDays - 1 }

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (["rep-pl-trend", "rep-expense-breakdown"].includes(w.id) && (chartSourceState.status !== "ready" || !companyCurrencyCode)) {
          return { ...w, type: "diagnostic", data: { code: "missing-measure", message: chartSourceState.status !== "ready" ? t("reports.reportsClient.financialSourceDataIsNotReadyRefreshBeforeInterpretingThisChart") : t("reports.reportsClient.selectACompanyWithAKnownReportingCurrencyToViewThis") } }
        }
        if (w.type === "combo-chart" && w.id === "rep-pl-trend") {
          return {
            ...w,
            data: { ...w.data, values: profitAndLossByMonth(chartLines, accountsById, now, 12, locale), valueFormat: money },
          }
        }
        if (w.id === "rep-cash-runway") {
          return { ...w, type: "diagnostic", data: { code: "missing-measure", message: t("reports.reportsClient.cashRunwayIsUnavailableUntilReconciledBankBalancesAndVerifiedCash") } }
        }
        if (w.type === "ranked-bars" && w.id === "rep-expense-breakdown") {
          return {
            ...w,
            data: {
              ...w.data,
              items: expenseBreakdown(chartLines, accountsById, currentWindow, previousWindow),
              valueFormat: money,
              changeLabel: "vs prior 90 days",
            },
          }
        }
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                {
                  label: t("reports.dashboard.kpis.totalReports"),
                  value: String(reports.length),
                  icon: "BarChart2",
                },
                {
                  label: t("reports.dashboard.kpis.generated"),
                  value: String(generated),
                  icon: "CheckCircle",
                },
                {
                  label: t("reports.dashboard.kpis.exported"),
                  value: String(exported),
                  icon: "Download",
                },
                {
                  label: t("reports.dashboard.kpis.trialLines"),
                  value: String(trialBalances.length),
                  icon: "Scale",
                },
                {
                  label: t("reports.dashboard.kpis.templates"),
                  value: String(reportTemplates.length),
                  icon: "template",
                },
                {
                  label: t("reports.dashboard.kpis.scheduled"),
                  value: String(scheduledReports.length),
                  icon: "Calendar",
                },
                {
                  label: t("reports.dashboard.kpis.metrics"),
                  value: String(analyticsMetrics.length),
                  icon: "gauge",
                },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            generate_report: () =>
              setQuickActionForm({ form: financialReportFormConfig, action: "generateReport" }),
            new_template: () =>
              setQuickActionForm({ form: reportTemplateFormConfig, action: "createReportTemplate" }),
            schedule_report: () =>
              setQuickActionForm({
                form: scheduledReportFormConfig,
                action: "createScheduledReport",
              }),
            new_metric: () =>
              setQuickActionForm({ form: analyticsMetricFormConfig, action: "createAnalyticsMetric" }),
            new_dashboard: () => setCreateDashboardOpen(true),
            new_widget: () => setCreateWidgetOpen(true),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] || (() => { }) })),
            },
          }
        }
        return w
          })
  }, [
    locale,
    reports,
    accountAccounts,
    accountAccountsQuery,
    accountMoves,
    accountMovesQuery,
    accountMoveLines,
    accountMoveLinesQuery,
    currenciesQuery,
    accountPayments,
    currencies,
    trialBalances,
    reportTemplates,
    scheduledReports,
    analyticsMetrics,
    moduleConfig,
    operatingCompanyId,
    t,
    scheduledReportFormConfig,
    financialReportFormConfig,
    reportTemplateFormConfig,
    analyticsMetricFormConfig,
  ])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
        if (tab.id === "dashboard") return { ...tab, label: t("reports.workspace.catalog") }
        if (tab.id === "reports") return routeReportId ? { ...tab, type: "custom" as const, customContent: (
          <ReportResult report={openedReport} sourceState={moduleQueryState(reportsQuery)} actionError={reportActionError}
            companyLabel={companySelectOptions.find((option) => option.value === String(operatingCompanyId))?.label ?? t("reports.workspace.unknown")}
            currencyLabel={moduleQueryState(currenciesQuery).status === "ready" ? currencySelectOptions.find((option) => option.value === String(openedReport?.resultCurrencyId ?? openedReport?.currencyId))?.label ?? t("reports.workspace.unknown") : t("reports.workspace.unknown")}
            onBack={() => router.push(reportWorkspaceHref(searchParams?.toString() ?? ""), { scroll: false })}
            actions={openedReport && checkPermission("financial_report", "write").allowed ? <>
              {reportCanDownload(openedReport) && (["pdf", "xlsx", "csv"] as const).map((format) => <Button key={format} variant="outline" disabled={exportFinancialReport.isPending || generateFinancialReport.isPending} onClick={() => { setReportActionError(null); void exportFinancialReport.mutateAsync({ reportId: String(openedReport.id), exportFormat: format }).catch((error: unknown) => setReportActionError(error instanceof Error ? error.message : t("reports.workspace.actionFailed"))) }}>{t(`reports.actions.${format === "pdf" ? "exportPdf" : format === "xlsx" ? "exportXlsx" : "exportCsv"}`)}</Button>)}
              {reportTag(openedReport.state) !== "archived" && <Button variant="outline" disabled={exportFinancialReport.isPending || generateFinancialReport.isPending} onClick={() => { setReportActionError(null); void generateFinancialReport.mutateAsync(String(openedReport.id)).catch((error: unknown) => setReportActionError(error instanceof Error ? error.message : t("reports.workspace.actionFailed"))) }}>{t("reports.actions.regenerate")}</Button>}
            </> : null}>
            {openedReport && statementKindForReportType(openedReport.reportType)
              ? <StatementsPanel key={String(openedReport.id)} organizationId={orgId} financialReports={[openedReport]} hideSelector currencyCode={moduleQueryState(currenciesQuery).status === "ready" ? currencyCodeMap(currencies).get(String(openedReport.resultCurrencyId ?? openedReport.currencyId)) : undefined} />
              : <><ModuleDataNotice state={moduleQueryState(trialBalancesQuery)} />{trialBalancesQuery.isLoading && <p role="status">{t("common.loading")}</p>}{moduleQueryState(trialBalancesQuery).status === "ready" && <EntityView config={reportOutputConfig} data={scopedReports(trialBalances, orgId, operatingCompanyId).filter((row) => String(row.reportId) === String(openedReport?.id))} />}</>}
          </ReportResult>
        ) } : { ...tab, entityConfig: financialReportsEntityConfig, createForm: financialReportFormConfig }
        if (tab.id === "trial-balance") return { ...tab, entityConfig: trialBalanceEntityConfig, createForm: trialBalanceEntryFormConfig, createAction: "createTrialBalanceEntry", createLabel: t("reports.trialBalance.createEntryLabel") }
        if (tab.id === "report-templates") return { ...tab, entityConfig: reportTemplatesEntityConfig, createForm: reportTemplateFormConfig }
        if (tab.id === "analytics-metrics") return { ...tab, entityConfig: analyticsMetricsEntityConfig, createForm: analyticsMetricFormConfig }
        if (tab.id === "scheduled-reports") {
          return {
            ...tab,
            entityConfig: scheduledReportsEntityConfig,
            createForm: scheduledReportFormConfig,
          }
        }
        if (tab.id === "dashboards") return { ...tab, entityConfig: dashboardsEntityConfig, createForm: dashboardFormConfig }
        if (tab.id === "dashboard-widgets") return { ...tab, entityConfig: dashboardWidgetsEntityConfig, createForm: dashboardWidgetFormConfig }
        if (tab.id === "owner-reports") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <OwnerReportsPanel
                organizationId={orgId}
                companies={companies}
                defaultCompanyId={
                  operatingCompanyId != null && operatingCompanyId > 0n
                    ? Number(operatingCompanyId)
                    : undefined
                }
              />
            ),
          }
        }
        if (tab.id === "pivot-explorer") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <PivotExplorer
                organizationId={orgId}
                companyId={operatingCompanyId}
                financialReports={reports as Record<string, unknown>[]}
                trialBalances={trialBalances as Record<string, unknown>[]}
              />
            ),
          }
        }
        if (tab.id === "statements") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <StatementsPanel
                organizationId={orgId}
                financialReports={reports as Record<string, unknown>[]}
              />
            ),
          }
        }
        if (tab.id === "vat-report") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <VatReportPanel
                key={validPeriodContext ? `${validPeriodContext.organizationId}:${validPeriodContext.companyId}:${validPeriodContext.periodId}` : `vat:${orgId}:${operatingCompanyId}`}
                organizationId={orgId}
                companyId={operatingCompanyId}
                financialReports={reports as Record<string, unknown>[]}
                periodContext={validPeriodContext ?? undefined}
                sourceState={moduleQueryState(reportsQuery)}
              />
            ),
          }
        }
        if (tab.id === "query-builder") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <QueryBuilder
                organizationId={orgId}
                companyId={operatingCompanyId}
                dashboards={dashboards as unknown as Record<string, unknown>[]}
                status={queryBuilderStatus}
                onStatusChange={setQueryBuilderStatus}
              />
            ),
          }
        }
        return tab
      }),
    }),
    [
      liveSections,
      moduleConfig,
      financialReportsEntityConfig,
      financialReportFormConfig,
      validPeriodContext,
      reportsQuery,
      trialBalanceEntityConfig,
      trialBalanceEntryFormConfig,
      reportTemplatesEntityConfig,
      analyticsMetricsEntityConfig,
      scheduledReportsEntityConfig,
      dashboardsEntityConfig,
      dashboardWidgetsEntityConfig,
      dashboardFormConfig,
      dashboardWidgetFormConfig,
      scheduledReportFormConfig,
      reportTemplateFormConfig,
      analyticsMetricFormConfig,
      reports,
      trialBalances,
      dashboards,
      queryBuilderStatus,
      companies,
      operatingCompanyId,
      orgId,
      t,
      routeReportId, openedReport, companySelectOptions, currencySelectOptions, router, searchParams, checkPermission, exportFinancialReport, generateFinancialReport, trialBalancesQuery, currenciesQuery, reportOutputConfig, reportActionError
    ],
  )

  const renderAuthoringPreview = (values: FormValues, formConfig: FormConfig) => {
    if (formConfig.id === "new-analytics-metric") return <MetricAuthoringPreview values={values} config={formConfig} />
    if (!reportAuthoringKind(formConfig.id)) return null
    return <ReportAuthoringPreview values={values} config={formConfig} organizationId={orgId} companyLabel={companySelectOptions.find((option) => option.value === String(operatingCompanyId ?? ""))?.label} />
  }

  const data = useMemo(
    () => ({
      reports: reports as unknown as Record<string, unknown>[],
      "trial-balance": filteredTrialBalances as unknown as Record<string, unknown>[],
      "report-templates": reportTemplates as unknown as Record<string, unknown>[],
      "scheduled-reports": scheduledReports as unknown as Record<string, unknown>[],
      "analytics-metrics": analyticsMetrics as unknown as Record<string, unknown>[],
      dashboards: dashboards as unknown as Record<string, unknown>[],
      "dashboard-widgets": dashboardWidgets as unknown as Record<string, unknown>[],
    }),
    [reports, filteredTrialBalances, reportTemplates, scheduledReports, analyticsMetrics, dashboards, dashboardWidgets],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    const source = action === "createReportTemplate" ? reportTemplatesQuery
      : action === "createScheduledReport" ? scheduledReportsQuery
      : action === "createAnalyticsMetric" ? analyticsMetricsQuery
      : action === "createDashboard" ? dashboardsQuery
      : action === "createDashboardWidget" ? dashboardWidgetsQuery : null
    if (source && moduleQueryState(source).status !== "ready") throw new Error(t("reports.forms.sourceUnavailable", { defaultValue: "Required report records could not be verified. Retry their source list before saving. Your entries are retained." }))
    if (action === "createReport" || action === "generateReport") {
      if (moduleQueryState(currenciesQuery).status !== "ready") throw new Error(t("reports.workspace.currencyUnavailable"))
      if (periodRequested && (!validPeriodContext || validPeriodContext.reportType !== "trial-balance")) throw new Error(t("reports.reportsClient.theSelectedPeriodReportContextIsNotReadyForTrialBalance"))
      const created = await createFinancialReportFlow.mutateAsync(toCreateFinancialReportPayload(validPeriodContext ? applyPeriodReportFormContext(formData, validPeriodContext) : formData))
      if (reportActionLive.current.scope === reportActionScope && reportActionLive.current.allowed) openReport(created.id)
    } else if (action === "createReportTemplate") {
      await createReportTemplate.mutateAsync(toCreateReportTemplatePayload(formData))
    } else if (action === "createScheduledReport") {
      if (moduleQueryState(reportTemplatesQuery).status !== "ready") throw new Error(t("reports.forms.scheduledReport.sourceUnavailable", { defaultValue: "Report templates could not be verified. Retry Report templates before saving this schedule. Your entries are retained." }))
      await createScheduledReport.mutateAsync(toCreateScheduledReportPayload(formData))
    } else if (action === "createAnalyticsMetric") {
      await createAnalyticsMetric.mutateAsync(toCreateAnalyticsMetricPayload(formData))
    } else if (action === "createTrialBalanceEntry") {
      const params = toCreateTrialBalanceEntryParams(formData)
      if (!params) throw new Error(t("common.paramsMapper.invalidTrialBalanceEntry"))
      await createTrialBalanceEntry.mutateAsync(params as unknown as Record<string, unknown>)
    } else if (action === "createDashboard") {
      await createDashboard.mutateAsync(toCreateDashboardPayload(formData))
      setCreateDashboardOpen(false)
    } else if (action === "createDashboardWidget") {
      await createDashboardWidget.mutateAsync({
        ...toCreateDashboardWidgetPayload(formData),
        creationRequestId: globalThis.crypto.randomUUID(),
      })
      setCreateWidgetOpen(false)
    } else {
      throw new Error(t("reports.forms.unsupportedAction", { defaultValue: "This form action is unavailable. Close and reopen the form before trying again." }))
    }
  }

  const isFormMutationPending =
    createTrialBalanceEntry.isPending ||
    createFinancialReportFlow.isPending ||
    generateFinancialReport.isPending ||
    exportFinancialReport.isPending ||
    archiveFinancialReport.isPending ||
    deleteFinancialReport.isPending ||
    createReportTemplate.isPending ||
    createScheduledReport.isPending ||
    createAnalyticsMetric.isPending ||
    updateReportTemplate.isPending ||
    updateMetricValues.isPending ||
    recordReportRun.isPending ||
    updateFinancialReport.isPending ||
    createDashboard.isPending ||
    createDashboardWidget.isPending ||
    addWidgetToDashboard.isPending ||
    updateWidgetLayout.isPending ||
    shareDashboard.isPending ||
    importReportTemplateCsv.isPending ||
    importAnalyticsMetricCsv.isPending

  const quickActionConfig = quickActionForm?.action === "createReport" || quickActionForm?.action === "generateReport" ? mergeFieldDefaultValues(financialReportFormConfig, validPeriodContext ? periodReportFormDefaults(validPeriodContext) : { reportType: quickActionForm?.reportType ?? "trialBalance" })
    : quickActionForm?.action === "createReportTemplate" ? reportTemplateFormConfig
    : quickActionForm?.action === "createScheduledReport" ? scheduledReportFormConfig
    : quickActionForm?.action === "createAnalyticsMetric" ? analyticsMetricFormConfig
    : quickActionForm?.form ?? financialReportFormConfig
  const quickActionSource = quickActionForm?.action === "createReportTemplate" ? moduleQueryState(reportTemplatesQuery)
    : quickActionForm?.action === "createScheduledReport" ? mergeModuleStates([moduleQueryState(scheduledReportsQuery), moduleQueryState(reportTemplatesQuery)])
    : quickActionForm?.action === "createAnalyticsMetric" ? moduleQueryState(analyticsMetricsQuery)
    : mergeModuleStates([moduleQueryState(reportsQuery), moduleQueryState(currenciesQuery)])
  const quickActionBlocked = quickActionForm != null && quickActionSource.status !== "ready"

  // The actor is part of ModuleView's scope key. Mounting its interactive state
  // before initial authorization resolves would discard selections and drafts
  // as soon as that key acquires the actor, even though the session did not change.
  if (permissionsReady === false || !currentUser?.id) return <p role="status" className="m-4 text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p>

  if (periodRequested && periodState.status !== "ready") return <ReportPeriodNotice state={periodState} context={periodContext} />

  return (
    <EntityLabelsProvider value={entityLabels}>
      {validPeriodContext ? <ReportPeriodNotice state={periodState} context={validPeriodContext} /> : null}
      <ModuleView
        key={reportActionScope}
        config={config}
        dashboardContent={<ReportStart reportTypes={validPeriodContext ? ["trialBalance"] : undefined} canGenerate={Boolean(operatingCompanyId && currentUser?.id && checkPermission("financial_report", "create").allowed && checkPermission("financial_report", "write").allowed)} sourceState={moduleQueryState(reportsQuery)} onGenerate={(reportType) => setQuickActionForm({ form: financialReportFormConfig, action: "generateReport", reportType })}><details><summary className="cursor-pointer py-3 text-sm font-medium">{t("reports.workspace.overview")}</summary><ModuleInsights input={{ module: "reports", organizationId, companyId: operatingCompanyId ?? 0n, records: { rows: reports, state: moduleQueryState(reportsQuery) }, currencies: { rows: currencies, state: moduleQueryState(currenciesQuery) } }} sections={liveSections.filter((section) => section.id !== "rep-quick-actions-section")} /></details></ReportStart>}
        data={data}
        dataState={{ reports: moduleQueryState(reportsQuery), "trial-balance": mergeModuleStates([moduleQueryState(reportsQuery), moduleQueryState(trialBalancesQuery)]), "vat-report": moduleQueryState(reportsQuery), "report-templates": moduleQueryState(reportTemplatesQuery), "scheduled-reports": moduleQueryState(scheduledReportsQuery), "analytics-metrics": moduleQueryState(analyticsMetricsQuery), dashboards: moduleQueryState(dashboardsQuery), "dashboard-widgets": moduleQueryState(dashboardWidgetsQuery) }}
        onFormSubmit={handleFormSubmit}
        renderCreatePreview={(_tabId, values, formConfig) => renderAuthoringPreview(values, formConfig)}
        isPending={isFormMutationPending}
        onRowClick={(tabId, row) => {
          if (tabId === "reports") {
            const id = row.id
            setSelectedReportId(id != null ? String(id) : null)
          }
        }}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionConfig}
        submissionDisabled={quickActionBlocked}
        submitError={quickActionBlocked ? t("reports.forms.sourceUnavailable", { defaultValue: "Required report records could not be verified. Retry their source list before saving. Your entries are retained." }) : null}
        formLeadingActions={quickActionBlocked && "onRetry" in quickActionSource && quickActionSource.onRetry ? <Button type="button" variant="outline" onClick={quickActionSource.onRetry}>{t("common.retry", { defaultValue: "Retry" })}</Button> : undefined}
        renderPreview={(values) => renderAuthoringPreview(values, quickActionConfig)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      <FormModal
        open={editTemplateOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditTemplateOpen(false)
            setEditTemplateId(null)
            setEditTemplateInitial(null)
          }
        }}
        key={`template-editor-${editTemplateId ?? "closed"}`}
        config={templateEditorForm(t, editTemplateInitial ?? { orientation: "Portrait" }, updateReportTemplate.isPending)}
        renderPreview={(values) => <TemplateLayoutPreview values={values} />}
        showSubmitSuccessToast={false}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (editTemplateId == null || !editTemplateInitial) throw new Error(t("reports.reportsClient.noTemplateSelected"))
          await updateReportTemplate.mutateAsync({
            expected: editTemplateInitial,
            templateId: editTemplateId,
            params: {
              orientation: String(formData.orientation ?? editTemplateInitial.orientation),
              paperFormat:
                formData.paperFormat != null && String(formData.paperFormat).trim() !== ""
                  ? String(formData.paperFormat).trim()
                  : undefined,
              templateContent:
                formData.templateContent != null && String(formData.templateContent) !== ""
                  ? String(formData.templateContent)
                  : undefined,
            },
          })
          toast.success(t("reports.layout.saved", { defaultValue: "Template layout saved" }))
        }}
      />
      <FormModal
        open={metricValuesOpen}
        onOpenChange={(open) => {
          if (!open) {
            setMetricValuesOpen(false)
            setMetricValuesId(null)
          }
        }}
        config={updateMetricValuesForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (metricValuesId == null) throw new Error(t("reports.forms.selectedRecordUnavailable", { defaultValue: "The selected record is unavailable. Close and reopen this form." }))
          const cv = Number(formData.currentValue)
          if (!Number.isFinite(cv)) throw new Error(t("reports.reportsClient.invalidCurrentValue"))
          const pvRaw = formData.previousValue
          const pv =
            pvRaw != null && String(pvRaw).trim() !== ""
              ? Number(pvRaw)
              : undefined
          await updateMetricValues.mutateAsync({
            metricId: metricValuesId,
            params: {
              currentValue: cv,
              previousValue: pv !== undefined && Number.isFinite(pv) ? pv : undefined,
            },
          })
        }}
      />
      <FormModal
        open={recordRunOpen}
        onOpenChange={(open) => {
          if (!open) {
            setRecordRunOpen(false)
            setRecordRunScheduledId(null)
          }
        }}
        config={recordScheduledRunForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (recordRunScheduledId == null) throw new Error(t("reports.forms.selectedRecordUnavailable", { defaultValue: "The selected record is unavailable. Close and reopen this form." }))
          const raw = formData.nextRun
          if (raw == null || String(raw).trim() === "") {
            throw new Error(t("reports.reportsClient.nextRunIsRequired"))
          }
          await recordReportRun.mutateAsync({
            reportId: recordRunScheduledId,
            nextRun: raw as string | number | Date,
          })
          setRecordRunOpen(false)
          setRecordRunScheduledId(null)
        }}
      />
      {csvKind && csvFormConfig ? (
        <CsvImportModal
          trackedImport={{ companyId: operatingCompanyId }}
          organizationId={orgId}
          tableName={csvKind === "report_template" ? "report_template" : "analytics_metric"}
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (csvKind === "report_template") {
              await importReportTemplateCsv.mutateAsync(text)
            } else {
              await importAnalyticsMetricCsv.mutateAsync(text)
            }
          }}
        />
      ) : null}

      {/* Update Financial Report Modal */}
      <FormModal
        open={editReportOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditReportOpen(false)
            setEditReportId(null)
          }
        }}
        config={updateFinancialReportForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (editReportId == null) return
          await updateFinancialReport.mutateAsync({
            reportId: editReportId,
            patch: toUpdateFinancialReportFormPayload(formData),
          })
          setEditReportOpen(false)
          setEditReportId(null)
        }}
      />

      {/* Create Dashboard Modal */}
      <FormModal
        open={createDashboardOpen}
        onOpenChange={(open) => !open && setCreateDashboardOpen(false)}
        config={dashboardFormConfig}
        renderPreview={(values) => renderAuthoringPreview(values, dashboardFormConfig)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          await handleFormSubmit("dashboard", "createDashboard", formData)
        }}
      />

      {/* Create Dashboard Widget Modal */}
      <FormModal
        open={createWidgetOpen}
        onOpenChange={(open) => !open && setCreateWidgetOpen(false)}
        config={dashboardWidgetFormConfig}
        renderPreview={(values) => renderAuthoringPreview(values, dashboardWidgetFormConfig)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          await handleFormSubmit("dashboard", "createDashboardWidget", formData)
        }}
      />

      {/* Add Widget to Dashboard Modal */}
      <FormModal
        open={addWidgetOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddWidgetOpen(false)
            setSelectedDashboardId(null)
          }
        }}
        config={addWidgetFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (selectedDashboardId == null) return
          const widgetId = String(formData.widgetId)
          await addWidgetToDashboard.mutateAsync({
            dashboardId: selectedDashboardId,
            widgetId,
          })
          await updateWidgetLayout.mutateAsync({
            widgetId,
            layout: {
              x: Number(formData.x ?? 0),
              y: Number(formData.y ?? 0),
              width: formData.width ?? "4",
              height: Number(formData.height ?? 200),
            },
          })
          setAddWidgetOpen(false)
          setSelectedDashboardId(null)
        }}
      />

      <FormModal
        open={updateLayoutOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUpdateLayoutOpen(false)
            setUpdateLayoutWidgetId(null)
          }
        }}
        config={updateWidgetLayoutForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (updateLayoutWidgetId == null) return
          await updateWidgetLayout.mutateAsync({
            widgetId: updateLayoutWidgetId,
            layout: {
              x: Number(formData.x ?? 0),
              y: Number(formData.y ?? 0),
              width: formData.width ?? "4",
              height: Number(formData.height ?? 200),
            },
          })
          setUpdateLayoutOpen(false)
          setUpdateLayoutWidgetId(null)
        }}
      />

      {/* Share Dashboard Modal */}
      <FormModal
        open={shareDashboardOpen}
        onOpenChange={(open) => {
          if (!open) {
            setShareDashboardOpen(false)
            setShareDashboardId(null)
          }
        }}
        config={shareDashboardForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (shareDashboardId == null) return
          const userIdRaw = formData.userId ? String(formData.userId).trim() : ""
          const teamIdRaw = formData.teamId ? String(formData.teamId).trim() : ""
          await shareDashboard.mutateAsync({
            dashboardId: shareDashboardId,
            params: {
              shareWith: userIdRaw !== "" ? [userIdRaw] : [],
              shareWithGroups: teamIdRaw !== "" ? [teamIdRaw] : [],
            },
          })
          setShareDashboardOpen(false)
          setShareDashboardId(null)
        }}
      />

      <Dialog
        open={viewDashboardId != null}
        onOpenChange={(open) => {
          if (!open) {
            setViewDashboardId(null)
            setViewDashboardRange("all")
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader className="pr-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <DialogTitle>{String(viewDashboard?.name ?? t("reports.dashboards.title"))}</DialogTitle>
                {viewDashboard?.description ? (
                  <DialogDescription>{String(viewDashboard.description)}</DialogDescription>
                ) : null}
              </div>
              {viewDashboard ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={viewDashboardRange}
                    onValueChange={(value) =>
                      setViewDashboardRange(value as "all" | "7d" | "30d" | "90d" | "ytd")
                    }
                  >
                    <SelectTrigger
                      aria-label={t("reports.actions.dashboardTimeRange")}
                      className="h-9 w-[150px]"
                      data-testid="stored-dashboard-time-range"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("reports.reportsClient.allTime")}</SelectItem>
                      <SelectItem value="7d">{t("reports.reportsClient.last7Days")}</SelectItem>
                      <SelectItem value="30d">{t("reports.reportsClient.last30Days")}</SelectItem>
                      <SelectItem value="90d">{t("reports.reportsClient.last90Days")}</SelectItem>
                      <SelectItem value="ytd">{t("reports.reportsClient.yearToDate")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    data-testid="stored-dashboard-export"
                    onClick={() => void handleStoredDashboardExport()}
                    disabled={
                      storedDashboardLoading
                      || storedDashboardRefreshing
                      || !storedDashboardExport.allowed
                    }
                    title={storedDashboardExport.reason}
                  >
                    <Download className="h-4 w-4" />
                    {t("reports.actions.exportDashboard")}
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogHeader>
          {viewDashboard ? (
            storedDashboardLoading ? (
              <p
                role="status"
                className="text-sm text-muted-foreground"
                data-testid="stored-dashboard-loading"
              >
                {t("common.loading", "Loading…")}
              </p>
            ) : (
              <div className="space-y-3">
                {storedDashboardRefreshing ? (
                  <p
                    role="status"
                    className="text-sm text-muted-foreground"
                    data-testid="stored-dashboard-refreshing"
                  >
                    {t("reports.dashboards.sourceRefreshing")}
                  </p>
                ) : null}
                {storedDashboardIssue ? (
                  <div
                    role="alert"
                    className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
                    data-testid={
                      storedDashboardIssue.kind === "denied"
                        ? "stored-dashboard-denied"
                        : "stored-dashboard-error"
                    }
                  >
                    <p>
                      {storedDashboardIssue.kind === "denied"
                        ? t("reports.dashboards.sourceDenied")
                        : t("reports.dashboards.sourceError")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void retryStoredDashboard()}
                      data-testid="stored-dashboard-retry"
                    >
                      {t("reports.dashboards.retrySource")}
                    </Button>
                  </div>
                ) : null}
                <StoredDashboardView
                  ref={storedDashboardRef}
                  dashboard={viewDashboard}
                  widgets={dashboardWidgets as unknown as Record<string, unknown>[]}
                  dataSources={storedDashboardDataSources}
                  sourceStates={storedDashboardSourceStates}
                  resolution={storedDashboardResolution ?? undefined}
                  timeRange={viewDashboardTimeRange}
                  organizationId={orgId}
                  onDrillTarget={handleStoredDashboardDrill}
                />
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </EntityLabelsProvider>
  )
}
