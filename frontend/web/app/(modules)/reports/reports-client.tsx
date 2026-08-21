"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useMemo, useState, useRef, useCallback } from "react"
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
  updateReportTemplateForm,
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
  exportDashboardToPng,
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
import type { EntityTableConfig, EntityViewConfig, FormConfig } from "@lumiere/ui"
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
import { reportStateTag } from "@/lib/reports-create-params"
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
import { useAccountAccounts } from "@lumiere/query-hooks/hooks/accounting"
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
import { PivotExplorer } from "./pivot-explorer"
import { VatReportPanel } from "./vat-report-panel"
import { QueryBuilder } from "./query-builder"

export { REPORTS_UI_REDUCERS } from "@/lib/reports-ui-reducers"

interface ReportsClientProps {
  initialReports?: Record<string, unknown>[]
  initialBalances?: Record<string, unknown>[]
  initialReportTemplates?: Record<string, unknown>[]
  initialScheduledReports?: Record<string, unknown>[]
  initialAnalyticsMetrics?: Record<string, unknown>[]
  initialDashboards?: Record<string, unknown>[]
  initialDashboardWidgets?: Record<string, unknown>[]
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
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => reportsModuleConfig(t), [t])
  /** BigInt organization id for React Query keys (matches `@lumiere/query-hooks` `organizationId` param). */
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [editTemplateOpen, setEditTemplateOpen] = useState(false)
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null)
  const [metricValuesOpen, setMetricValuesOpen] = useState(false)
  const [metricValuesId, setMetricValuesId] = useState<string | null>(null)
  const [recordRunOpen, setRecordRunOpen] = useState(false)
  const [recordRunScheduledId, setRecordRunScheduledId] = useState<string | null>(null)
  const [csvKind, setCsvKind] = useState<"report_template" | "analytics_metric" | null>(null)

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
  const openErpAiChat = useOpenErpAiChat()

  const { data: reportsRaw = [] } = useFinancialReports(orgId, initialReports)
  const { data: trialBalances = [] } = useTrialBalances(orgId, initialBalances)
  const { data: reportTemplates = [] } = useReportTemplates(orgId, initialReportTemplates)
  const { data: scheduledReports = [] } = useScheduledReports(orgId, initialScheduledReports)
  const { data: analyticsMetrics = [] } = useAnalyticsMetrics(orgId, initialAnalyticsMetrics)
  const { data: dashboards = [] } = useDashboards(orgId, initialDashboards)
  const { data: dashboardWidgets = [] } = useDashboardWidgets(orgId, initialDashboardWidgets)
  const { data: companies = [] } = useCompanies(organizationId, organizationId > 0)
  const { data: accountAccounts = [] } = useAccountAccounts(orgId)
  const { data: currencies = [] } = useCurrencies()

  const reports = useMemo(
    () =>
      reportsRaw.map((r) => ({
        ...r,
        state: reportStateTag((r as { state?: unknown }).state),
      })),
    [reportsRaw],
  )

  const createTrialBalanceEntry = useCreateTrialBalanceEntry(orgId, operatingCompanyId)
  const createFinancialReportFlow = useCreateFinancialReportFlow(orgId, operatingCompanyId)
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
        label: `${String(row.name ?? row.id)} (id ${String(row.id)})`,
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
      dashboardWidgets as unknown as Record<string, unknown>[],
    )
  }, [viewDashboard, dashboardWidgets])

  const { dataSources: storedDashboardDataSources, isLoading: storedDashboardLoading } =
    useStoredDashboardDataSources(orgId, viewDashboardModels)

  const viewDashboardTimeRange = useMemo(
    () => (viewDashboardRange === "all" ? undefined : timeRangeToMs(viewDashboardRange)),
    [viewDashboardRange],
  )

  const storedDashboardRef = useRef<HTMLDivElement>(null)
  const handleStoredDashboardExport = useCallback(async () => {
    if (!storedDashboardRef.current || !viewDashboard) return
    await exportDashboardToPng(
      storedDashboardRef.current,
      String(viewDashboard.name ?? "dashboard"),
    )
  }, [viewDashboard])

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
    () =>
      mergeSelectOptionsForFields(newFinancialReportForm(t), {
        currencyId: currencySelectOptions,
      }),
    [t, currencySelectOptions],
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
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newAnalyticsMetricForm(t), {
          companyId: companySelectOptions,
        }),
        { companyId: operatingCompanyId != null ? String(operatingCompanyId) : "" },
      ),
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
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newDashboardWidgetForm(t), {
          companyId: companySelectOptions,
        }),
        { companyId: operatingCompanyId != null ? String(operatingCompanyId) : "" },
      ),
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
    if (selectedReportId == null) return trialBalances
    return trialBalances.filter((row) => String(row.reportId) === selectedReportId)
  }, [trialBalances, selectedReportId])

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
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "exp-pdf",
            label: t("reports.actions.exportPdf"),
            icon: FileDown,
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (String(r.state) === "generated") {
                  void exportFinancialReport.mutateAsync({
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
            onClick: (rows) => {
              for (const r of rows) {
                if (String(r.state) === "generated") {
                  void exportFinancialReport.mutateAsync({
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
            onClick: (rows) => {
              for (const r of rows) {
                if (String(r.state) === "generated") {
                  void exportFinancialReport.mutateAsync({
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
            onClick: (rows) => {
              for (const r of rows) {
                if (String(r.state) === "draft") {
                  void generateFinancialReport.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "arch",
            label: t("reports.actions.archive"),
            icon: Archive,
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (String(r.state) === "exported") {
                  void archiveFinancialReport.mutateAsync(r.id as string | number | bigint)
                }
              }
            },
          },
          {
            id: "del",
            label: t("reports.actions.delete"),
            icon: Trash2,
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                const st = String(r.state)
                if (st !== "archived") {
                  void deleteFinancialReport.mutateAsync(r.id as string | number | bigint)
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
            label: "Ask AI",
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
              setEditTemplateId(String(first.id))
              setEditTemplateOpen(true)
            },
          },
        ],
      },
    }
  }, [moduleConfig.tabs, t])

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

  const liveSections = useMemo(() => {
    const generated = reports.filter((r) => String(r.state) === "generated").length
    const exported = reports.filter((r) => String(r.state) === "exported").length

    return mapDashboardWidgets(moduleConfig, (w) => {
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
    reports,
    trialBalances,
    reportTemplates,
    scheduledReports,
    analyticsMetrics,
    moduleConfig,
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
        if (tab.id === "reports") return { ...tab, entityConfig: financialReportsEntityConfig }
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
        if (tab.id === "dashboards") return { ...tab, entityConfig: dashboardsEntityConfig }
        if (tab.id === "dashboard-widgets") return { ...tab, entityConfig: dashboardWidgetsEntityConfig }
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
        if (tab.id === "vat-report") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <VatReportPanel
                organizationId={orgId}
                companyId={operatingCompanyId}
                financialReports={reports as Record<string, unknown>[]}
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
                dashboards={dashboards as unknown as Record<string, unknown>[]}
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
      trialBalanceEntityConfig,
      trialBalanceEntryFormConfig,
      reportTemplatesEntityConfig,
      analyticsMetricsEntityConfig,
      scheduledReportsEntityConfig,
      dashboardsEntityConfig,
      dashboardWidgetsEntityConfig,
      scheduledReportFormConfig,
      reportTemplateFormConfig,
      analyticsMetricFormConfig,
      reports,
      trialBalances,
      dashboards,
      companies,
      operatingCompanyId,
      orgId,
      t
    ],
  )

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
    if (action === "createReport" || action === "generateReport") {
      await createFinancialReportFlow.mutateAsync(toCreateFinancialReportPayload(formData))
    } else if (action === "createReportTemplate") {
      await createReportTemplate.mutateAsync(toCreateReportTemplatePayload(formData))
    } else if (action === "createScheduledReport") {
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
      await createDashboardWidget.mutateAsync(toCreateDashboardWidgetPayload(formData))
      setCreateWidgetOpen(false)
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

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
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
        config={quickActionForm?.form ?? financialReportFormConfig}
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
          }
        }}
        config={updateReportTemplateForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (editTemplateId == null) return
          await updateReportTemplate.mutateAsync({
            templateId: editTemplateId,
            params: {
              orientation: String(formData.orientation ?? "Portrait"),
              paperFormat:
                formData.paperFormat != null && String(formData.paperFormat).trim() !== ""
                  ? String(formData.paperFormat).trim()
                  : undefined,
              templateContent:
                formData.templateContent != null && String(formData.templateContent).trim() !== ""
                  ? String(formData.templateContent).trim()
                  : undefined,
            },
          })
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
          if (metricValuesId == null) return
          const cv = Number(formData.currentValue)
          if (!Number.isFinite(cv)) throw new Error("Invalid current value")
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
          if (recordRunScheduledId == null) return
          const raw = formData.nextRun
          if (raw == null || String(raw).trim() === "") {
            throw new Error("Next run is required")
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
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <DialogTitle>{String(viewDashboard?.name ?? t("reports.dashboards.title"))}</DialogTitle>
                {viewDashboard?.description ? (
                  <DialogDescription>{String(viewDashboard.description)}</DialogDescription>
                ) : null}
              </div>
              {viewDashboard ? (
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    aria-label={t("reports.actions.dashboardTimeRange")}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={viewDashboardRange}
                    onChange={(event) =>
                      setViewDashboardRange(
                        event.target.value as "all" | "7d" | "30d" | "90d" | "ytd",
                      )
                    }
                    data-testid="stored-dashboard-time-range"
                  >
                    <option value="all">All time</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                    <option value="ytd">Year to date</option>
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => void handleStoredDashboardExport()}
                    disabled={storedDashboardLoading}
                  >
                    <Download className="h-4 w-4" />
                    {t("reports.actions.exportDashboard")}
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogHeader>
          {viewDashboard ? (
            <StoredDashboardView
              ref={storedDashboardRef}
              dashboard={viewDashboard}
              widgets={dashboardWidgets as unknown as Record<string, unknown>[]}
              dataSources={storedDashboardDataSources}
              timeRange={viewDashboardTimeRange}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
