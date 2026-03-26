"use client"

import { useTranslation } from "@lumiere/i18n"
import { ForensicsView, DashboardHeader } from "@lumiere/ui"

export default function ForensicsPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <DashboardHeader title={t("forensics.page.title")} description={t("forensics.page.description")} />
      <ForensicsView className="h-[calc(100vh-12rem)]" />
    </div>
  )
}
