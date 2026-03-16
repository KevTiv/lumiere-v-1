"use client"

import { DashboardHeader, DashboardGrid } from "@lumiere/ui"
import { iotDashboard } from "@/lib/module-dashboard-configs"

export default function IotPage() {
  return (
    <div className="flex flex-col min-h-full">
      <DashboardHeader
        title={iotDashboard.title}
        description={iotDashboard.description}
      />
      <DashboardGrid sections={iotDashboard.sections} />
    </div>
  )
}
