"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newFinancialReportForm, MissingOrganization } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { reportsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useFinancialReports,
  useTrialBalances,
  useCreateReportTemplate,
  type CreateReportTemplateParams,
} from "@/hooks/reports"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

interface ReportsClientProps {
  initialReports?: Record<string, unknown>[]
  initialBalances?: Record<string, unknown>[]
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

function ReportsClientLoaded({ initialReports, initialBalances, organizationId }: ReportsClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => reportsModuleConfig(t), [t])
  const { companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: reports = [] } = useFinancialReports(companyId, initialReports)
  const { data: trialBalances = [] } = useTrialBalances(companyId, initialBalances)
  const createReportTemplate = useCreateReportTemplate(companyId)

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
                { label: "Total Reports", value: String(reports.length), icon: "BarChart2" },
                { label: "Generated", value: String(generated), icon: "CheckCircle" },
                { label: "Exported", value: String(exported), icon: "Download" },
                { label: "Trial Balances", value: String(trialBalances.length), icon: "Scale" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_report: () => setQuickActionForm({ form: newFinancialReportForm(t), action: "createReport" }),
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
  }, [reports, trialBalances, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections, moduleConfig],
  )

  const data = useMemo(
    () => ({
      "financial-reports": reports as unknown as Record<string, unknown>[],
      "trial-balances": trialBalances as unknown as Record<string, unknown>[],
    }),
    [reports, trialBalances],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createReport" || action === "generateReport") {
      const name = String(formData.name ?? "").trim()
      if (!name) return
      const df = new Date(String(formData.dateFrom ?? ""))
      const dt = new Date(String(formData.dateTo ?? ""))
      if (Number.isNaN(df.getTime()) || Number.isNaN(dt.getTime())) return
      createReportTemplate.mutate({
        name,
        model: "account.move",
        reportType: "financial",
        orientation: "Portrait",
        marginTop: 10,
        marginBottom: 10,
        marginLeft: 7,
        marginRight: 7,
        headerLine: true,
        footerLine: true,
        attachmentUse: false,
        multiCompany: false,
        isActive: true,
        description: [
          `Date from: ${String(formData.dateFrom ?? "")}`,
          `Date to: ${String(formData.dateTo ?? "")}`,
          `Target move: ${String(formData.targetMove ?? "posted")}`,
          `Show zero lines: ${Boolean(formData.showZeroLines)}`,
          `Show hierarchy: ${Boolean(formData.showHierarchy)}`,
          `Show percentage: ${Boolean(formData.showPercentage)}`,
        ].join("\n"),
        templateContent: undefined,
        paperFormat: undefined,
        printReportName: name,
        attachment: undefined,
        metadata: JSON.stringify({
          dateFrom: formData.dateFrom ?? null,
          dateTo: formData.dateTo ?? null,
          targetMove: formData.targetMove ?? "posted",
          showZeroLines: Boolean(formData.showZeroLines),
          showHierarchy: Boolean(formData.showHierarchy),
          showPercentage: Boolean(formData.showPercentage),
        }),
      } as CreateReportTemplateParams)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newFinancialReportForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
