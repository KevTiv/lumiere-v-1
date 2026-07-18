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
        wbs: String(tk.wbsCode ?? ""),
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
                <th className="px-3 py-2">WBS</th>
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
                  <td className="px-3 py-2 text-muted-foreground">{row.wbs || "—"}</td>
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
  hrResources,
  allocations,
  capacity,
  employeeSkills,
  skills,
  onBookAllocation,
}: {
  employees: QueryRows
  hrResources: QueryRows
  allocations: QueryRows
  capacity: QueryRows
  employeeSkills: QueryRows
  skills: QueryRows
  onBookAllocation?: () => void
}) {
  const { t } = useTranslation()

  const skillName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of skills as Record<string, unknown>[]) {
      m.set(String(s.id), String(s.name ?? ""))
    }
    return m
  }, [skills])

  const skillsByEmployee = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const row of employeeSkills as Record<string, unknown>[]) {
      if (row.active === false) continue
      const eid = String(row.employeeId ?? "")
      if (!eid) continue
      const label = `${skillName.get(String(row.skillId ?? "")) ?? "Skill"} L${row.level ?? "?"}`
      const list = m.get(eid) ?? []
      list.push(label)
      m.set(eid, list)
    }
    return m
  }, [employeeSkills, skillName])

  const capacityRows = useMemo(() => {
    const empName = new Map<string, string>()
    for (const e of employees as Record<string, unknown>[]) {
      empName.set(String(e.id), String(e.name ?? ""))
    }
    const resName = new Map<string, string>()
    for (const r of hrResources as Record<string, unknown>[]) {
      resName.set(String(r.id), String(r.name ?? ""))
    }
    return (capacity as Record<string, unknown>[])
      .map((c) => {
        const empId = c.employeeId != null ? String(c.employeeId) : ""
        const resourceId = c.resourceId != null ? String(c.resourceId) : ""
        const remaining = Number(c.remainingHours ?? 0)
        return {
          id: String(c.id),
          label:
            (empId && empName.get(empId)) ||
            (resourceId && resName.get(resourceId)) ||
            `Resource ${resourceId || empId || "—"}`,
          available: Number(c.availableHours ?? 0),
          leave: Number(c.leaveHours ?? 0),
          allocated: Number(c.allocatedHours ?? 0),
          actual: Number(c.actualHours ?? 0),
          remaining,
          over: remaining < -0.001,
          skillHint: empId ? (skillsByEmployee.get(empId) ?? []).slice(0, 3).join(", ") : "",
        }
      })
      .sort((a, b) => a.remaining - b.remaining)
  }, [capacity, employees, hrResources, skillsByEmployee])

  const bookingRows = useMemo(() => {
    const empName = new Map<string, string>()
    for (const e of employees as Record<string, unknown>[]) {
      empName.set(String(e.id), String(e.name ?? ""))
    }
    return (allocations as Record<string, unknown>[])
      .filter((a) => a.active !== false)
      .map((a) => ({
        id: String(a.id),
        employee: empName.get(String(a.employeeId ?? "")) ?? "—",
        projectId: String(a.projectId ?? ""),
        hours: Number(a.allocatedHours ?? 0),
        percent: Number(a.allocationPercent ?? 0),
        from: microsToDateLabel(a.dateFrom),
        to: microsToDateLabel(a.dateTo),
      }))
      .slice(0, 40)
  }, [allocations, employees])

  return (
    <div className="space-y-6 p-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("projects.resourceAllocation.title")}</h2>
          <p className="text-sm text-muted-foreground">
            Live capacity = available − leave − allocations − actual timesheet hours (snapshot table).
          </p>
        </div>
        {onBookAllocation ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            onClick={onBookAllocation}
          >
            Book allocation
          </button>
        ) : null}
      </div>

      {capacityRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No capacity snapshots yet. Book an allocation or approve leave to materialise remaining hours.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">Leave</th>
                <th className="px-3 py-2 text-right">Allocated</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Remaining</th>
                <th className="px-3 py-2">Skills (soft match)</th>
              </tr>
            </thead>
            <tbody>
              {capacityRows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  <td className="px-3 py-2 text-right">{row.available.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right">{row.leave.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right">{row.allocated.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right">{row.actual.toFixed(1)}h</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${row.over ? "text-destructive" : ""}`}
                  >
                    {row.remaining.toFixed(1)}h
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {row.skillHint || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">Bookings</h3>
        {bookingRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("projects.resourceAllocation.emptyMessage")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2">{t("projects.resourceAllocation.columns.employee")}</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2 text-right">Hours / %</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">To</th>
                </tr>
              </thead>
              <tbody>
                {bookingRows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{row.employee}</td>
                    <td className="px-3 py-2">{row.projectId}</td>
                    <td className="px-3 py-2 text-right">
                      {row.hours > 0 ? `${row.hours}h` : `${row.percent}%`}
                    </td>
                    <td className="px-3 py-2">{row.from}</td>
                    <td className="px-3 py-2">{row.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** Available vs billable / non-billable hours from `resource_utilisation_snapshot`. */
export function ResourceUtilisationPanel({
  employees,
  utilisation,
}: {
  employees: QueryRows
  utilisation: QueryRows
}) {
  const rows = useMemo(() => {
    const empName = new Map<string, string>()
    for (const e of employees as Record<string, unknown>[]) {
      empName.set(String(e.id), String(e.name ?? ""))
    }
    return (utilisation as Record<string, unknown>[])
      .map((u) => {
        const empId = String(u.employeeId ?? "")
        return {
          id: String(u.id),
          employee: (empName.get(empId) ?? empId) || "—",
          available: Number(u.availableHours ?? 0),
          billable: Number(u.billableHours ?? 0),
          nonBillable: Number(u.nonBillableHours ?? 0),
          utilisation: Number(u.utilisationPercent ?? 0),
          billableUtil: Number(u.billableUtilisationPercent ?? 0),
        }
      })
      .sort((a, b) => b.utilisation - a.utilisation)
  }, [employees, utilisation])

  return (
    <div className="space-y-4 p-1" data-testid="proj-utilisation-panel">
      <div>
        <h2 className="text-lg font-semibold">Utilisation</h2>
        <p className="text-sm text-muted-foreground">
          Available hours (calendar capacity) vs billable and non-billable timesheet hours.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No utilisation snapshots yet. Validate timesheets or refresh utilisation to materialise
          rows.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">Billable</th>
                <th className="px-3 py-2 text-right">Non-billable</th>
                <th className="px-3 py-2 text-right">Util %</th>
                <th className="px-3 py-2 text-right">Billable util %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{row.employee}</td>
                  <td className="px-3 py-2 text-right">{row.available.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right">{row.billable.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right">{row.nonBillable.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right">{Math.round(row.utilisation)}%</td>
                  <td className="px-3 py-2 text-right">{Math.round(row.billableUtil)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
