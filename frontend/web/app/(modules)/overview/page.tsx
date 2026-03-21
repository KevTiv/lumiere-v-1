import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/dashboard-config"

export default function OverviewPage() {
  const config = dashboardConfigs.overview ?? dashboardConfigs.sales
  return (
    <div className="space-y-6">
      <DashboardHeader title="Overview" description="Your business at a glance" />
      <DashboardGrid sections={config.sections} />
    </div>
  )
}
