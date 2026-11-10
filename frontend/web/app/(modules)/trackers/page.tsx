"use client"

import { useTranslation } from "@lumiere/i18n"
import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/dashboard-config"
import { ModulePageComposition, usePageCompositionActionSlot } from "@lumiere/ui/pages/page-composition-host"

export default function TrackersPage() {
  const { t } = useTranslation()
  const { target, slot } = usePageCompositionActionSlot()
  const config = dashboardConfigs.analytics ?? dashboardConfigs.sales
  return (
    <div className="space-y-6">
      <DashboardHeader secondaryAction={slot} title={t("trackers.page.title")} description={t("trackers.page.description")} />
      <ModulePageComposition actionTarget={target} moduleId="trackers" pageId="dashboard" title={t("trackers.page.title")} sections={config.sections}>
        <DashboardGrid sections={config.sections} />
      </ModulePageComposition>
    </div>
  )
}
