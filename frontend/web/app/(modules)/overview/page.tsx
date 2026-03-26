"use client"

import { useTranslation } from "@lumiere/i18n"
import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/dashboard-config"

export default function OverviewPage() {
  const { t } = useTranslation()
  const config = dashboardConfigs.overview ?? dashboardConfigs.sales
  return (
    <div className="space-y-6">
      <DashboardHeader title={t("overview.page.title")} description={t("overview.page.description")} />
      <DashboardGrid sections={config.sections} />
    </div>
  )
}
