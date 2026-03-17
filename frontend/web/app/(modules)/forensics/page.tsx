"use client"

import { ForensicsView, DashboardHeader } from "@lumiere/ui"

export default function ForensicsPage() {
  return (
    <div className="space-y-4">
      <DashboardHeader title="Forensics" description="Incident tracking and analysis" />
      <ForensicsView className="h-[calc(100vh-12rem)]" />
    </div>
  )
}
