"use client"

import { useTranslation } from "@lumiere/i18n"
import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/dashboard-config"

export default function TrackersPage() {
  const { t } = useTranslation()
  const config = dashboardConfigs.analytics ?? dashboardConfigs.sales
  return (
    <div className="space-y-6">
      <DashboardHeader title={t("trackers.page.title")} description={t("trackers.page.description")} />
      <DashboardGrid sections={config.sections} />
    </div>
  )
}
