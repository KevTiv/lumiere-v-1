"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { QueryRows } from "@lumiere/query-hooks/http"

type DeptNode = {
  id: string
  name: string
  managerName: string | null
  employees: Array<{ id: string; name: string; jobTitle: string }>
  children: DeptNode[]
}

function buildOrgTree(
  departments: QueryRows,
  employees: QueryRows,
): DeptNode[] {
  const empById = new Map<string, Record<string, unknown>>()
  for (const e of employees) {
    empById.set(String(e.id), e as Record<string, unknown>)
  }

  const byParent = new Map<string | null, Record<string, unknown>[]>()
  for (const d of departments) {
    const row = d as Record<string, unknown>
    const parentKey =
      row.parentId != null && String(row.parentId).trim() !== ""
        ? String(row.parentId)
        : null
    const bucket = byParent.get(parentKey) ?? []
    bucket.push(row)
    byParent.set(parentKey, bucket)
  }

  const empsByDept = new Map<string, Array<{ id: string; name: string; jobTitle: string }>>()
  for (const e of employees) {
    const row = e as Record<string, unknown>
    if (!row.isActive) continue
    const deptId = row.departmentId != null ? String(row.departmentId) : ""
    if (!deptId) continue
    const bucket = empsByDept.get(deptId) ?? []
    bucket.push({
      id: String(row.id),
      name: String(row.name ?? ""),
      jobTitle: String(row.jobTitle ?? ""),
    })
    empsByDept.set(deptId, bucket)
  }

  function build(parentId: string | null): DeptNode[] {
    const rows = byParent.get(parentId) ?? []
    return rows
      .filter((d) => d.isActive !== false)
      .map((d) => {
        const id = String(d.id)
        const manager =
          d.managerId != null ? empById.get(String(d.managerId)) : undefined
        return {
          id,
          name: String(d.name ?? d.completeName ?? id),
          managerName: manager ? String(manager.name ?? "") : null,
          employees: empsByDept.get(id) ?? [],
          children: build(id),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return build(null)
}

function OrgChartRow({ node, depth }: { node: DeptNode; depth: number }) {
  const { t } = useTranslation()
  return (
    <li className="list-none">
      <div
        className="rounded-md border border-border px-3 py-2 mb-2"
        style={{ marginLeft: depth * 20 }}
      >
        <div className="font-medium">{node.name}</div>
        {node.managerName ? (
          <div className="text-xs text-muted-foreground">
            {t("hr.orgChart.manager")}: {node.managerName}
          </div>
        ) : null}
        {node.employees.length > 0 ? (
          <div className="text-xs text-muted-foreground mt-1">
            {node.employees.length} {t("hr.orgChart.employees")}
            <ul className="mt-1 space-y-0.5 pl-3">
              {node.employees.slice(0, 8).map((e) => (
                <li key={e.id}>
                  {e.name}
                  {e.jobTitle ? ` · ${e.jobTitle}` : ""}
                </li>
              ))}
              {node.employees.length > 8 ? (
                <li>+{node.employees.length - 8} more</li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <OrgChartRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function OrgChartPanel({
  departments,
  employees,
}: {
  departments: QueryRows
  employees: QueryRows
}) {
  const { t } = useTranslation()
  const tree = useMemo(
    () => buildOrgTree(departments, employees),
    [departments, employees],
  )

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="text-lg font-semibold">{t("hr.orgChart.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("hr.orgChart.description")}</p>
      </div>
      {tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hr.orgChart.emptyMessage")}</p>
      ) : (
        <ul className="rounded-lg border border-border p-3">
          {tree.map((node) => (
            <OrgChartRow key={node.id} node={node} depth={0} />
          ))}
        </ul>
      )}
    </div>
  )
}

function formatCompEventDate(raw: unknown): string {
  if (raw == null) return "—"
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return String(raw)
  const ms = n > 1e15 ? n / 1000 : n
  return new Date(ms).toLocaleDateString()
}

export function CompensationTimelinePanel({
  contractId,
  events,
}: {
  contractId: string
  events: QueryRows
}) {
  const rows = useMemo(() => {
    return events
      .filter((e) => String((e as Record<string, unknown>).contractId) === contractId)
      .sort((a, b) => {
        const ae = Number((a as Record<string, unknown>).effectiveFrom ?? 0)
        const be = Number((b as Record<string, unknown>).effectiveFrom ?? 0)
        return be - ae
      })
  }, [contractId, events])

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No compensation changes recorded for this contract yet.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const r = row as Record<string, unknown>
        return (
          <li key={String(r.id)} className="rounded-md border border-border px-3 py-2 text-sm">
            <div className="font-medium">{formatCompEventDate(r.effectiveFrom)}</div>
            <div className="text-muted-foreground">
              Wage: {String(r.wage ?? "—")}
              {r.reason ? ` · ${String(r.reason)}` : ""}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function fieldOrDash(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = record[key]
    if (v != null && String(v).trim() !== "") return String(v)
  }
  return "—"
}

/** Simple approval timeline from leave row approval fields (audit tab covers full history). */
export function LeaveApprovalTimelinePanel({
  record,
}: {
  record: Record<string, unknown>
}) {
  const state = fieldOrDash(record, "state", "State")
  const steps = [
    { label: "Created", detail: fieldOrDash(record, "createdAt", "created_at") },
    { label: "Manager", detail: fieldOrDash(record, "managerId", "manager_id") },
    { label: "First approver", detail: fieldOrDash(record, "firstApproverId", "first_approver_id") },
    { label: "Second approver", detail: fieldOrDash(record, "secondApproverId", "second_approver_id") },
    { label: "Current state", detail: state },
  ]

  return (
    <div className="space-y-3" data-testid="hr-leave-approval-timeline">
      {steps.map((step) => (
        <div key={step.label} className="rounded-md border border-border px-3 py-2 text-sm">
          <div className="font-medium">{step.label}</div>
          <div className="text-muted-foreground">{step.detail}</div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Full mutation history is on the Audit tab.
      </p>
    </div>
  )
}

export function HrOpsQueuePanel({
  leavesToApprove,
  payslipsToExport,
  hrIntegrationIntentsPending,
}: {
  leavesToApprove: number
  payslipsToExport: number
  hrIntegrationIntentsPending?: number
}) {
  return (
    <div
      className="rounded-lg border p-4 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="hr-ops-queue-panel"
    >
      <div className="rounded-md border px-3 py-2">
        <div className="text-xs text-muted-foreground">Leaves to approve</div>
        <div className="text-2xl font-semibold tabular-nums">{leavesToApprove}</div>
      </div>
      <div className="rounded-md border px-3 py-2">
        <div className="text-xs text-muted-foreground">Payslips to export</div>
        <div className="text-2xl font-semibold tabular-nums">{payslipsToExport}</div>
      </div>
      <div className="rounded-md border px-3 py-2">
        <div className="text-xs text-muted-foreground">Integration intents pending</div>
        <div className="text-2xl font-semibold tabular-nums">{hrIntegrationIntentsPending ?? 0}</div>
      </div>
    </div>
  )
}

export function HrAdvancedWfmPanel({
  laborCostSnapshots,
  shiftOptJobs,
  globalAssignments,
  capacityForecast,
}: {
  laborCostSnapshots: number
  shiftOptJobs: number
  globalAssignments: number
  capacityForecast: number
}) {
  return (
    <div
      className="rounded-lg border p-4 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="hr-advanced-wfm-panel"
    >
      <div className="rounded-md border px-3 py-2">
        <div className="text-xs text-muted-foreground">Labor cost snapshots</div>
        <div className="text-2xl font-semibold tabular-nums">{laborCostSnapshots}</div>
      </div>
      <div className="rounded-md border px-3 py-2">
        <div className="text-xs text-muted-foreground">Shift opt jobs</div>
        <div className="text-2xl font-semibold tabular-nums">{shiftOptJobs}</div>
      </div>
      <div className="rounded-md border px-3 py-2">
        <div className="text-xs text-muted-foreground">Global assignments</div>
        <div className="text-2xl font-semibold tabular-nums">{globalAssignments}</div>
      </div>
      <div className="rounded-md border px-3 py-2">
        <div className="text-xs text-muted-foreground">Capacity forecast rows</div>
        <div className="text-2xl font-semibold tabular-nums">{capacityForecast}</div>
      </div>
    </div>
  )
}
