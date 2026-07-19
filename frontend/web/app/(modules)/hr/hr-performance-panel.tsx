"use client"

import { useMemo, useState } from "react"

import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
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
export function HrPerformancePanel({
  organizationId,
  companyId,
  employees,
}: HrPerformancePanelProps) {
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

  const activeCycles = useMemo(
    () =>
      (cycles as QueryRows).filter((row) => {
        const state = String((row as Record<string, unknown>).state ?? "")
        return state !== "closed"
      }),
    [cycles],
  )

  const draftReviews = useMemo(
    () =>
      (reviews as QueryRows).filter(
        (row) => String((row as Record<string, unknown>).state ?? "") === "draft",
      ),
    [reviews],
  )

  const submittedReviews = useMemo(
    () =>
      (reviews as QueryRows).filter(
        (row) => String((row as Record<string, unknown>).state ?? "") === "submitted",
      ),
    [reviews],
  )

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
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
        <h3 className="text-sm font-medium">Performance cycles</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="max-w-xs"
            placeholder="Cycle name"
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
            Create cycle
          </Button>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1">
          {activeCycles.slice(0, 5).map((row) => {
            const r = row as Record<string, unknown>
            return (
              <li key={String(r.id)}>
                {String(r.name ?? `Cycle ${rowId(r)}`)} — {String(r.state ?? "draft")}
              </li>
            )
          })}
          {activeCycles.length === 0 ? <li>No active cycles yet.</li> : null}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Add goal</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Cycle" />
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
              <SelectValue placeholder="Employee" />
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
            placeholder="Goal title"
            value={goalTitle}
            onChange={(e) => setGoalTitle(e.target.value)}
          />
          <Button
            size="sm"
            disabled={
              !selectedCycleId || !goalEmployeeId || !goalTitle.trim() || addGoal.isPending
            }
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
            Add goal
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {(goals as QueryRows).length} goal(s) · {(reviews as QueryRows).length} review(s)
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Submit review (self)</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedReviewId} onValueChange={setSelectedReviewId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Draft review" />
            </SelectTrigger>
            <SelectContent>
              {draftReviews.map((row) => {
                const r = row as Record<string, unknown>
                return (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    Employee {rowNum(r, "employeeId", "employee_id")} / cycle{" "}
                    {rowNum(r, "cycleId", "cycle_id")}
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
            Submit
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Complete review (manager)</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={selectedReviewId}
            onValueChange={setSelectedReviewId}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Submitted review" />
            </SelectTrigger>
            <SelectContent>
              {submittedReviews.map((row) => {
                const r = row as Record<string, unknown>
                return (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    Employee {rowNum(r, "employeeId", "employee_id")} / cycle{" "}
                    {rowNum(r, "cycleId", "cycle_id")}
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
            Complete
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
