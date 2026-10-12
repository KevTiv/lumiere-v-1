import { notFound } from "next/navigation"
import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/dashboard-config"

/** Local sample-data preview; unavailable in production. */
export default function DashboardPreview() {
  if (process.env.NODE_ENV !== "development") notFound()
  const config = dashboardConfigs.sales
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <DashboardHeader title={config.title} description="Local preview · sample data" />
      <DashboardGrid sections={config.sections} />
    </main>
  )
}
