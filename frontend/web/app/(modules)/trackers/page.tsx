import { DashboardGrid, DashboardHeader } from "@lumiere/ui"
import { dashboardConfigs } from "@/lib/demo-dashboard-config"

export default function TrackersPage() {
  const config = dashboardConfigs.analytics ?? dashboardConfigs.sales
  return (
    <div className="space-y-6">
      <DashboardHeader title="Trackers" description="KPI and metric tracking" />
      <DashboardGrid sections={config.sections} />
    </div>
  )
}
