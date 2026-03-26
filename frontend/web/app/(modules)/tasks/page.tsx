"use client"

import { useTranslation } from "@lumiere/i18n"
import { TaskBoardView, DashboardHeader } from "@lumiere/ui"

export default function TasksPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <DashboardHeader title={t("tasks.page.title")} description={t("tasks.page.description")} />
      <TaskBoardView className="h-[calc(100vh-12rem)]" />
    </div>
  )
}
