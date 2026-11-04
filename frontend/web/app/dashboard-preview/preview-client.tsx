"use client"

import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/dashboard-config"

/** The server page owns admission; interactive sample widgets stay client-owned. */
export function DashboardPreviewClient() {
  const config = dashboardConfigs.sales
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <DashboardHeader title={config.title} description="Local preview · sample data" />
      <DashboardGrid sections={config.sections} />
    </main>
  )
}
