"use client"

import { useTranslation } from "@lumiere/i18n"
import { SettingsModule, DashboardHeader } from "@lumiere/ui"

export default function SettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <DashboardHeader title={t("settings.page.title")} description={t("settings.page.description")} />
      <SettingsModule />
    </div>
  )
}
