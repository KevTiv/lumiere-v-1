"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { QueryRows } from "@lumiere/query-hooks/http"

function microsToDateLabel(raw: unknown): string {
  const ms = Number(raw ?? 0) / 1000
  if (!ms) return "—"
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function taskProgress(task: Record<string, unknown>): number {
  const state = String(task.kanbanState ?? task.state ?? "")
  if (state === "Done" || task.isClosed) return 100
  if (state === "Cancelled") return 0
  const planned = Number(task.plannedHours ?? 0)
  const spent = Number(task.effectiveHours ?? 0)
  if (planned > 0) return Math.min(100, Math.round((spent / planned) * 100))
  return state === "InProgress" ? 50 : 25
}

export function ProjectGanttPanel({
  projects,
  tasks,
}: {
  projects: QueryRows
  tasks: QueryRows
}) {
  const { t } = useTranslation()

  const rows = useMemo(() => {
    const projectName = new Map<string, string>()
    for (const p of projects) {
      projectName.set(String((p as Record<string, unknown>).id), String((p as Record<string, unknown>).name ?? ""))
    }
    return (tasks as Record<string, unknown>[])
      .filter((tk) => !tk.isClosed && String(tk.kanbanState) !== "Cancelled")
      .sort((a, b) => Number(a.dateDeadline ?? 0) - Number(b.dateDeadline ?? 0))
      .slice(0, 50)
      .map((tk) => ({
        id: String(tk.id),
        task: String(tk.name ?? ""),
        project: projectName.get(String(tk.projectId ?? "")) ?? "—",
        deadline: microsToDateLabel(tk.dateDeadline),
        status: String(tk.kanbanState ?? tk.state ?? "—"),
        progress: taskProgress(tk),
      }))
  }, [projects, tasks])

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="text-lg font-semibold">{t("projects.gantt.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("projects.gantt.description")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("projects.gantt.emptyMessage")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2">{t("projects.gantt.columns.task")}</th>
                <th className="px-3 py-2">{t("projects.gantt.columns.project")}</th>
                <th className="px-3 py-2">{t("projects.gantt.columns.deadline")}</th>
                <th className="px-3 py-2">{t("projects.gantt.columns.status")}</th>
                <th className="px-3 py-2 w-48">{t("projects.gantt.columns.progress")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{row.task}</td>
                  <td className="px-3 py-2">{row.project}</td>
                  <td className="px-3 py-2">{row.deadline}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded"
                          style={{ width: `${row.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8">{row.progress}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function ResourceAllocationPanel({
  employees,
  timesheets,
}: {
  employees: QueryRows
  timesheets: QueryRows
}) {
  const { t } = useTranslation()

  const rows = useMemo(() => {
    const empName = new Map<string, string>()
    for (const e of employees) {
      empName.set(String((e as Record<string, unknown>).id), String((e as Record<string, unknown>).name ?? ""))
    }
    const byEmployee = new Map<
      string,
      { hours: number; projectIds: Set<string>; taskIds: Set<string> }
    >()
    for (const ts of timesheets) {
      const row = ts as Record<string, unknown>
      const empId = row.employeeId != null ? String(row.employeeId) : ""
      if (!empId) continue
      const bucket = byEmployee.get(empId) ?? {
        hours: 0,
        projectIds: new Set<string>(),
        taskIds: new Set<string>(),
      }
      bucket.hours += Number(row.unitAmount ?? 0)
      if (row.projectId != null) bucket.projectIds.add(String(row.projectId))
      if (row.taskId != null) bucket.taskIds.add(String(row.taskId))
      byEmployee.set(empId, bucket)
    }
    return Array.from(byEmployee.entries())
      .map(([empId, stats]) => ({
        id: empId,
        employee: empName.get(empId) ?? `Employee ${empId.slice(-4)}`,
        hours: Math.round(stats.hours * 10) / 10,
        projects: stats.projectIds.size,
        tasks: stats.taskIds.size,
      }))
      .sort((a, b) => b.hours - a.hours)
  }, [employees, timesheets])

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="text-lg font-semibold">{t("projects.resourceAllocation.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("projects.resourceAllocation.description")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("projects.resourceAllocation.emptyMessage")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2">{t("projects.resourceAllocation.columns.employee")}</th>
                <th className="px-3 py-2 text-right">{t("projects.resourceAllocation.columns.hours")}</th>
                <th className="px-3 py-2 text-right">{t("projects.resourceAllocation.columns.projects")}</th>
                <th className="px-3 py-2 text-right">{t("projects.resourceAllocation.columns.tasks")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{row.employee}</td>
                  <td className="px-3 py-2 text-right">{row.hours}h</td>
                  <td className="px-3 py-2 text-right">{row.projects}</td>
                  <td className="px-3 py-2 text-right">{row.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
