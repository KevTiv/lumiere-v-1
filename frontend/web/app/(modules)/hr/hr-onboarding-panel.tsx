"use client"

import { useMemo, useState } from "react"

import { Button } from "@lumiere/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import type { QueryRows } from "@lumiere/query-hooks/http"
import {
  useAssignOnboardingTemplate,
  useCompleteOnboardingItem,
  useMarkOnboardingDone,
  useOnboardingProgress,
  useOnboardingTemplateItems,
  useOnboardingTemplates,
} from "@lumiere/query-hooks/hooks/hr"

function rowId(row: Record<string, unknown>): number {
  return Number(row.id ?? row.Id ?? 0)
}

function rowNum(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const v = row[key]
    if (v != null && v !== "") return Number(v)
  }
  return 0
}

interface HrOnboardingPanelProps {
  organizationId: bigint
  companyId: bigint
  employeeId: number
}

/** Employee record sheet tab — hire onboarding checklist progress. */
export function HrOnboardingPanel({
  organizationId,
  companyId,
  employeeId,
}: HrOnboardingPanelProps) {
  const { data: templates = [] } = useOnboardingTemplates(organizationId)
  const { data: templateItems = [] } = useOnboardingTemplateItems(organizationId)
  const { data: progress = [] } = useOnboardingProgress(organizationId)
  const assignTemplate = useAssignOnboardingTemplate(organizationId, companyId)
  const completeItem = useCompleteOnboardingItem(organizationId, companyId)
  const markDone = useMarkOnboardingDone(organizationId, companyId)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  const employeeProgress = useMemo(
    () =>
      (progress as QueryRows).filter(
        (row) => rowNum(row as Record<string, unknown>, "employeeId", "employee_id") === employeeId,
      ),
    [progress, employeeId],
  )

  const assignment = useMemo(
    () =>
      employeeProgress.find(
        (row) =>
          rowNum(row as Record<string, unknown>, "templateItemId", "template_item_id") === 0,
      ) as Record<string, unknown> | undefined,
    [employeeProgress],
  )

  const templateId = assignment
    ? rowNum(assignment, "templateId", "template_id")
    : 0

  const itemProgress = useMemo(() => {
    const items = (templateItems as QueryRows).filter(
      (row) => rowNum(row as Record<string, unknown>, "templateId", "template_id") === templateId,
    )
    return items.map((item) => {
      const itemRow = item as Record<string, unknown>
      const itemId = rowId(itemRow)
      const prog = employeeProgress.find(
        (p) =>
          rowNum(p as Record<string, unknown>, "templateItemId", "template_item_id") === itemId,
      ) as Record<string, unknown> | undefined
      return { item: itemRow, prog }
    })
  }, [templateItems, templateId, employeeProgress])

  const assignmentStatus = String(assignment?.status ?? assignment?.Status ?? "")
  const isDone = assignmentStatus === "done"

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    }
  }

  if (!assignment) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No onboarding checklist assigned. Choose a template to start hire onboarding.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select template" />
            </SelectTrigger>
            <SelectContent>
              {(templates as QueryRows).map((tpl) => {
                const row = tpl as Record<string, unknown>
                return (
                  <SelectItem key={String(row.id)} value={String(row.id)}>
                    {String(row.name ?? `Template ${String(row.id)}`)}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!selectedTemplateId || assignTemplate.isPending}
            onClick={() =>
              void run(() =>
                assignTemplate.mutateAsync({
                  employeeId,
                  templateId: Number(selectedTemplateId),
                }),
              )
            }
          >
            Assign template
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Status:{" "}
          <span className="font-medium">{isDone ? "Complete" : "In progress"}</span>
        </p>
        {!isDone ? (
          <Button
            size="sm"
            variant="outline"
            disabled={markDone.isPending}
            onClick={() => void run(() => markDone.mutateAsync(employeeId))}
          >
            Mark onboarding done
          </Button>
        ) : null}
      </div>
      <ul className="space-y-2">
        {itemProgress.map(({ item, prog }) => {
          const itemId = rowId(item)
          const title = String(item.title ?? item.name ?? `Item ${itemId}`)
          const required = Boolean(item.required)
          const complete =
            String(prog?.status ?? prog?.Status ?? "") === "complete" ||
            prog?.completedAt != null ||
            prog?.completed_at != null
          return (
            <li
              key={itemId}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span>
                {title}
                {required ? " *" : ""}
              </span>
              {complete ? (
                <span className="text-muted-foreground">Done</span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isDone || completeItem.isPending}
                  onClick={() =>
                    void run(() =>
                      completeItem.mutateAsync({ employeeId, templateItemId: itemId }),
                    )
                  }
                >
                  Complete
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
