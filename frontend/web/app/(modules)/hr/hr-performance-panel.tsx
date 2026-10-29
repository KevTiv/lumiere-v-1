"use client"

import { useMemo, useState } from "react"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import type { QueryRows } from "@lumiere/query-hooks/http"
import {
  useAddPerformanceGoal,
  useCompletePerformanceReview,
  useCreatePerformanceCycle,
  usePerformanceCycles,
  usePerformanceGoals,
  usePerformanceReviews,
  useSubmitPerformanceReview,
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

interface HrPerformancePanelProps {
  organizationId: bigint
  companyId: bigint
  employees: QueryRows
}

/** HR module tab — performance cycles, goals, and review workflow (MVP). */
export function HrPerformancePanel({ organizationId, companyId, employees }: HrPerformancePanelProps) {
  const { t } = useTranslation()
  const { data: cycles = [] } = usePerformanceCycles(organizationId)
  const { data: goals = [] } = usePerformanceGoals(organizationId)
  const { data: reviews = [] } = usePerformanceReviews(organizationId)
  const createCycle = useCreatePerformanceCycle(organizationId, companyId)
  const addGoal = useAddPerformanceGoal(organizationId, companyId)
  const submitReview = useSubmitPerformanceReview(organizationId, companyId)
  const completeReview = useCompletePerformanceReview(organizationId, companyId)

  const [cycleName, setCycleName] = useState("")
  const [selectedCycleId, setSelectedCycleId] = useState<string>("")
  const [goalEmployeeId, setGoalEmployeeId] = useState<string>("")
  const [goalTitle, setGoalTitle] = useState("")
  const [selfRating, setSelfRating] = useState("3")
  const [managerRating, setManagerRating] = useState("3")
  const [selectedReviewId, setSelectedReviewId] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  const cycleStateLabels: Record<string, string> = {
    active: t("hr.performance.status.active", { defaultValue: "Active" }),
    draft: t("hr.performance.status.draft", { defaultValue: "Draft" }),
    closed: t("hr.performance.status.closed", { defaultValue: "Closed" }),
  }

  const activeCycles = useMemo(
    () =>
      (cycles as QueryRows).filter((row) => {
        const state = String((row as Record<string, unknown>).state ?? "")
        return state !== "closed"
      }),
    [cycles],
  )

  const draftReviews = useMemo(
    () => (reviews as QueryRows).filter((row) => String((row as Record<string, unknown>).state ?? "") === "draft"),
    [reviews],
  )

  const submittedReviews = useMemo(
    () => (reviews as QueryRows).filter((row) => String((row as Record<string, unknown>).state ?? "") === "submitted"),
    [reviews],
  )

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("hr.performance.actionFailed", { defaultValue: "Action failed" }))
    }
  }

  const defaultCycleDates = () => {
    const start = new Date()
    const end = new Date()
    end.setMonth(end.getMonth() + 3)
    return { start, end }
  }

  return (
    <div className="space-y-8 p-1">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          {t("hr.performance.cycles.title", {
            defaultValue: "Performance cycles",
          })}
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="max-w-xs"
            placeholder={t("hr.performance.cycles.namePlaceholder", {
              defaultValue: "Cycle name",
            })}
            value={cycleName}
            onChange={(e) => setCycleName(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!cycleName.trim() || createCycle.isPending}
            onClick={() => {
              const { start, end } = defaultCycleDates()
              void run(async () => {
                await createCycle.mutateAsync({
                  name: cycleName.trim(),
                  startDate: start,
                  endDate: end,
                  state: "active",
                  active: true,
                })
                setCycleName("")
              })
            }}
          >
            {t("hr.performance.cycles.create", {
              defaultValue: "Create cycle",
            })}
          </Button>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1">
          {activeCycles.slice(0, 5).map((row) => {
            const r = row as Record<string, unknown>
            return (
              <li key={String(r.id)}>
                {String(
                  r.name ??
                    t("hr.performance.cycles.fallbackName", {
                      defaultValue: "Cycle {{id}}",
                      id: rowId(r),
                    }),
                )}{" "}
                — {cycleStateLabels[String(r.state ?? t("purchasing.purchasingBlanketWorkspace.draft"))] ?? String(r.state ?? t("purchasing.purchasingBlanketWorkspace.draft"))}
              </li>
            )
          })}
          {activeCycles.length === 0 ? (
            <li>
              {t("hr.performance.cycles.empty", {
                defaultValue: "No active cycles yet.",
              })}
            </li>
          ) : null}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("hr.performance.goals.addTitle", { defaultValue: "Add goal" })}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue
                placeholder={t("hr.performance.cycles.selectPlaceholder", {
                  defaultValue: "Cycle",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {activeCycles.map((row) => {
                const r = row as Record<string, unknown>
                return (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    {String(r.name ?? r.id)}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Select value={goalEmployeeId} onValueChange={setGoalEmployeeId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue
                placeholder={t("hr.performance.employeePlaceholder", {
                  defaultValue: "Employee",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {(employees as QueryRows).map((row) => {
                const r = row as Record<string, unknown>
                return (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    {String(r.name ?? r.id)}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Input
            className="max-w-xs"
            placeholder={t("hr.performance.goals.titlePlaceholder", {
              defaultValue: "Goal title",
            })}
            value={goalTitle}
            onChange={(e) => setGoalTitle(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!selectedCycleId || !goalEmployeeId || !goalTitle.trim() || addGoal.isPending}
            onClick={() =>
              void run(async () => {
                await addGoal.mutateAsync({
                  cycleId: Number(selectedCycleId),
                  employeeId: Number(goalEmployeeId),
                  title: goalTitle.trim(),
                  state: "in_progress",
                  weight: 1,
                })
                setGoalTitle("")
              })
            }
          >
            {t("hr.performance.goals.add", { defaultValue: "Add goal" })}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("hr.performance.goals.count", {
            defaultValue: "{{count}} goals",
            count: (goals as QueryRows).length,
          })}{" "}
          ·{" "}
          {t("hr.performance.reviews.count", {
            defaultValue: "{{count}} reviews",
            count: (reviews as QueryRows).length,
          })}
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          {t("hr.performance.reviews.submitSelfTitle", {
            defaultValue: "Submit review (self)",
          })}
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedReviewId} onValueChange={setSelectedReviewId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue
                placeholder={t("hr.performance.reviews.draftPlaceholder", {
                  defaultValue: "Draft review",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {draftReviews.map((row) => {
                const r = row as Record<string, unknown>
                return (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    {t("hr.performance.reviews.option", {
                      defaultValue: "Employee {{employeeId}} / cycle {{cycleId}}",
                      employeeId: rowNum(r, "employeeId", "employee_id"),
                      cycleId: rowNum(r, "cycleId", "cycle_id"),
                    })}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Input
            className="w-20"
            type="number"
            min={0}
            max={5}
            step={0.5}
            value={selfRating}
            onChange={(e) => setSelfRating(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!selectedReviewId || submitReview.isPending}
            onClick={() =>
              void run(async () => {
                await submitReview.mutateAsync({
                  reviewId: Number(selectedReviewId),
                  selfRating: Number(selfRating),
                })
              })
            }
          >
            {t("hr.performance.reviews.submit", { defaultValue: "Submit" })}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          {t("hr.performance.reviews.completeManagerTitle", {
            defaultValue: "Complete review (manager)",
          })}
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedReviewId} onValueChange={setSelectedReviewId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue
                placeholder={t("hr.performance.reviews.submittedPlaceholder", {
                  defaultValue: "Submitted review",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {submittedReviews.map((row) => {
                const r = row as Record<string, unknown>
                return (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    {t("hr.performance.reviews.option", {
                      defaultValue: "Employee {{employeeId}} / cycle {{cycleId}}",
                      employeeId: rowNum(r, "employeeId", "employee_id"),
                      cycleId: rowNum(r, "cycleId", "cycle_id"),
                    })}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Input
            className="w-20"
            type="number"
            min={0}
            max={5}
            step={0.5}
            value={managerRating}
            onChange={(e) => setManagerRating(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!selectedReviewId || completeReview.isPending}
            onClick={() =>
              void run(async () => {
                await completeReview.mutateAsync({
                  reviewId: Number(selectedReviewId),
                  managerRating: Number(managerRating),
                })
              })
            }
          >
            {t("hr.performance.reviews.complete", { defaultValue: "Complete" })}
          </Button>
        </div>
      </section>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
