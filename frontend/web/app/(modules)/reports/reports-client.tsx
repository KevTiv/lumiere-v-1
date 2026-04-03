"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newFinancialReportForm,
  newReportTemplateForm,
  newScheduledReportForm,
  newAnalyticsMetricForm,
  newTrialBalanceEntryForm,
  updateReportTemplateForm,
  updateMetricValuesForm,
  recordScheduledRunForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  financialReportsTableConfig,
  reportTemplatesTableConfig,
  analyticsMetricsTableConfig,
  trialBalancesTableConfig,
  scheduledReportsTableConfig,
} from "@lumiere/ui"
import type { EntityTableConfig, EntityViewConfig, FormConfig } from "@lumiere/ui"
import { reportsModuleConfig } from "@/lib/module-dashboard-configs"
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
} from "@/hooks/reports"
import { reportStateTag } from "@/lib/reports-create-params"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
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
} from "lucide-react"

interface ReportsClientProps {
  initialReports?: Record<string, unknown>[]
  initialBalances?: Record<string, unknown>[]
  initialReportTemplates?: Record<string, unknown>[]
  initialScheduledReports?: Record<string, unknown>[]
  initialAnalyticsMetrics?: Record<string, unknown>[]
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
  organizationId,
}: ReportsClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => reportsModuleConfig(t), [t])
  const { companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [editTemplateOpen, setEditTemplateOpen] = useState(false)
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null)
  const [metricValuesOpen, setMetricValuesOpen] = useState(false)
  const [metricValuesId, setMetricValuesId] = useState<string | null>(null)
  const [recordRunOpen, setRecordRunOpen] = useState(false)
  const [recordRunScheduledId, setRecordRunScheduledId] = useState<string | null>(null)

  const { data: reportsRaw = [] } = useFinancialReports(companyId, initialReports)
  const { data: trialBalances = [] } = useTrialBalances(companyId, initialBalances)
  const { data: reportTemplates = [] } = useReportTemplates(companyId, initialReportTemplates)
  const { data: scheduledReports = [] } = useScheduledReports(companyId, initialScheduledReports)
  const { data: analyticsMetrics = [] } = useAnalyticsMetrics(companyId, initialAnalyticsMetrics)

  const reports = useMemo(
    () =>
      reportsRaw.map((r) => ({
        ...r,
        state: reportStateTag((r as { state?: unknown }).state),
      })),
    [reportsRaw],
  )

  const createTrialBalanceEntry = useCreateTrialBalanceEntry(companyId)
  const createFinancialReportFlow = useCreateFinancialReportFlow(companyId)
  const generateFinancialReport = useGenerateFinancialReport(companyId)
  const exportFinancialReport = useExportFinancialReport(companyId)
  const archiveFinancialReport = useArchiveFinancialReport(companyId)
  const deleteFinancialReport = useDeleteFinancialReport(companyId)
  const createReportTemplate = useCreateReportTemplate(companyId)
  const createScheduledReport = useCreateScheduledReport(companyId)
  const createAnalyticsMetric = useCreateAnalyticsMetric(companyId)
  const updateReportTemplate = useUpdateReportTemplate(companyId)
  const updateMetricValues = useUpdateMetricValues(companyId)
  const recordReportRun = useRecordReportRun(companyId)

  const templateSelectOptions = useMemo(
    () =>
      reportTemplates.map((row) => ({
        value: String(row.id ?? ""),
        label: `${String(row.name ?? row.id)} (id ${String(row.id)})`,
      })),
    [reportTemplates],
  )

  const scheduledReportFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newScheduledReportForm(t), {
        reportTemplateId: templateSelectOptions,
      }),
    [t, templateSelectOptions],
  )

  const filteredTrialBalances = useMemo(() => {
    if (selectedReportId == null) return trialBalances
    return trialBalances.filter((row) => String(row.reportId) === selectedReportId)
  }, [trialBalances, selectedReportId])

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
        ],
      },
    }
  }, [
    t,
    exportFinancialReport,
    generateFinancialReport,
    archiveFinancialReport,
    deleteFinancialReport,
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

  const trialBalanceEntryFormConfig = useMemo(() => newTrialBalanceEntryForm(t), [t])

  const trialBalanceEntityConfig = useMemo((): EntityViewConfig => {
    const base = trialBalancesTableConfig(t)
    return {
      ...base,
      description: selectedReportId
        ? t("reports.trialBalance.filteredHint", { id: selectedReportId })
        : t("reports.trialBalance.selectReportHint"),
    }
  }, [t, selectedReportId])

  const liveSections = useMemo(() => {
    const generated = reports.filter((r) => String(r.state) === "generated").length
    const exported = reports.filter((r) => String(r.state) === "exported").length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
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
              setQuickActionForm({ form: newFinancialReportForm(t), action: "generateReport" }),
            new_template: () =>
              setQuickActionForm({ form: newReportTemplateForm(t), action: "createReportTemplate" }),
            schedule_report: () =>
              setQuickActionForm({
                form: scheduledReportFormConfig,
                action: "createScheduledReport",
              }),
            new_metric: () =>
              setQuickActionForm({ form: newAnalyticsMetricForm(t), action: "createAnalyticsMetric" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
      }),
    }))
  }, [
    reports,
    trialBalances,
    reportTemplates,
    scheduledReports,
    analyticsMetrics,
    moduleConfig,
    t,
    scheduledReportFormConfig,
  ])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) => {
        if (tab.id === "dashboard") return { ...tab, sections: liveSections }
        if (tab.id === "reports") return { ...tab, entityConfig: financialReportsEntityConfig }
        if (tab.id === "trial-balance") return { ...tab, entityConfig: trialBalanceEntityConfig, createForm: trialBalanceEntryFormConfig, createAction: "createTrialBalanceEntry", createLabel: t("reports.trialBalance.createEntryLabel") }
        if (tab.id === "report-templates") return { ...tab, entityConfig: reportTemplatesEntityConfig }
        if (tab.id === "analytics-metrics") return { ...tab, entityConfig: analyticsMetricsEntityConfig }
        if (tab.id === "scheduled-reports") {
          return {
            ...tab,
            entityConfig: scheduledReportsEntityConfig,
            createForm: scheduledReportFormConfig,
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
      scheduledReportFormConfig,
    ],
  )

  const data = useMemo(
    () => ({
      reports: reports as unknown as Record<string, unknown>[],
      "trial-balance": filteredTrialBalances as unknown as Record<string, unknown>[],
      "report-templates": reportTemplates as unknown as Record<string, unknown>[],
      "scheduled-reports": scheduledReports as unknown as Record<string, unknown>[],
      "analytics-metrics": analyticsMetrics as unknown as Record<string, unknown>[],
    }),
    [reports, filteredTrialBalances, reportTemplates, scheduledReports, analyticsMetrics],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createReport" || action === "generateReport") {
      await createFinancialReportFlow.mutateAsync(formData)
    } else if (action === "createReportTemplate") {
      await createReportTemplate.mutateAsync(formData)
    } else if (action === "createScheduledReport") {
      await createScheduledReport.mutateAsync(formData)
    } else if (action === "createAnalyticsMetric") {
      await createAnalyticsMetric.mutateAsync(formData)
    } else if (action === "createTrialBalanceEntry") {
      await createTrialBalanceEntry.mutateAsync(formData)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
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
        config={quickActionForm?.form ?? newFinancialReportForm(t)}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
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
    </>
  )
}
