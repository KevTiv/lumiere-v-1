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
