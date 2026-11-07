"use client"

import { useTranslation } from "@lumiere/i18n"
import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/dashboard-config"
import { ModulePageComposition } from "@lumiere/ui/pages/page-composition-host"

export default function TrackersPage() {
  const { t } = useTranslation()
  const config = dashboardConfigs.analytics ?? dashboardConfigs.sales
  return (
    <div className="space-y-6">
      <DashboardHeader title={t("trackers.page.title")} description={t("trackers.page.description")} />
      <ModulePageComposition moduleId="trackers" pageId="dashboard" title={t("trackers.page.title")} sections={config.sections}>
        <DashboardGrid sections={config.sections} />
      </ModulePageComposition>
    </div>
  )
}
