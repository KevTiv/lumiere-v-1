"use client"

import { TaskBoardView, DashboardHeader } from "@lumiere/ui"

export default function TasksPage() {
  return (
    <div className="space-y-4">
      <DashboardHeader title="Tasks" description="Manage sprints and workitems" />
      <TaskBoardView className="h-[calc(100vh-12rem)]" />
    </div>
  )
}
