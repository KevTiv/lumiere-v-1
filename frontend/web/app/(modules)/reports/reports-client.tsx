"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newFinancialReportForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { reportsModuleConfig } from "@/lib/module-dashboard-configs"
import { useFinancialReports, useTrialBalances, useStdbConnection, getStdbConnection, reportsSubscriptions } from "@lumiere/stdb"

interface ReportsClientProps {
  initialReports?: Record<string, unknown>[]
  initialBalances?: Record<string, unknown>[]
  organizationId?: number
}

export function ReportsClient({ initialReports, initialBalances, organizationId }: ReportsClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => reportsModuleConfig(t), [t])
  const companyId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] reports subscription error", err))
      .subscribe(reportsSubscriptions([companyId]))
  }, [connected, companyId])

  const { data: reports = [] } = useFinancialReports(companyId, initialReports)
  const { data: trialBalances = [] } = useTrialBalances(companyId, initialBalances)

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
    _action: string,
    _formData: Record<string, unknown>,
  ) => {
    // reducers for reports can be wired here
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
