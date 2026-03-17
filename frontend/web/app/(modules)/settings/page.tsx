"use client"

import { SettingsModule, DashboardHeader } from "@lumiere/ui"

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Settings" description="Manage your account and system configuration" />
      <SettingsModule />
    </div>
  )
}
