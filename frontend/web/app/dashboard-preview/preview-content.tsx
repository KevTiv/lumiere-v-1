"use client"

import { useTranslation } from "@lumiere/i18n"
import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { salesDashboard } from "@/lib/dashboard-config"

export function DashboardPreviewContent() {
  const { t } = useTranslation()
  const config = salesDashboard(t)
  return <main className="mx-auto max-w-7xl space-y-6 p-8">
    <DashboardHeader title={config.title} description={t("demo.preview.localPreview")} />
    <DashboardGrid sections={config.sections} />
  </main>
}
