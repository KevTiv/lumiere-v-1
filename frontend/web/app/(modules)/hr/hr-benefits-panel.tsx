"use client"

import { useState } from "react"

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
  useAssignBenefitEnrollment,
  useBenefitEnrollments,
  useBenefitPlans,
  useCreateBenefitPlan,
  useUnenrollBenefitEnrollment,
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

interface HrBenefitsPanelProps {
  organizationId: bigint
  companyId: bigint
  employees: QueryRows
}

const PLAN_TYPES = [
  { value: "health", label: "Health" },
  { value: "dental", label: "Dental" },
  { value: "retirement", label: "Retirement" },
  { value: "other", label: "Other" },
]

/** HR module tab — benefit plans and employee enrollments (MVP stub). */
export function HrBenefitsPanel({
  organizationId,
  companyId,
  employees,
}: HrBenefitsPanelProps) {
  const { data: plans = [] } = useBenefitPlans(organizationId)
  const { data: enrollments = [] } = useBenefitEnrollments(organizationId)
  const createPlan = useCreateBenefitPlan(organizationId, companyId)
  const assignEnrollment = useAssignBenefitEnrollment(organizationId, companyId)
  const unenroll = useUnenrollBenefitEnrollment(organizationId, companyId)

  const [planName, setPlanName] = useState("")
  const [planType, setPlanType] = useState("health")
  const [selectedPlanId, setSelectedPlanId] = useState<string>("")
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    }
  }

  const activePlans = (plans as QueryRows).filter((row) =>
    Boolean((row as Record<string, unknown>).active ?? (row as Record<string, unknown>).Active),
  )

  const enrolledRows = (enrollments as QueryRows).filter(
    (row) => String((row as Record<string, unknown>).state ?? "") === "enrolled",
  )

  return (
    <div className="space-y-8 p-1">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Benefit plans</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="max-w-xs"
            placeholder="Plan name"
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
          />
          <Select value={planType} onValueChange={setPlanType}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_TYPES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!planName.trim() || createPlan.isPending}
            onClick={() =>
              void run(async () => {
                await createPlan.mutateAsync({
                  name: planName.trim(),
                  planType,
                  active: true,
                })
                setPlanName("")
              })
            }
          >
            Create plan
          </Button>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1">
          {activePlans.slice(0, 8).map((row) => {
            const r = row as Record<string, unknown>
            return (
              <li key={String(r.id)}>
                {String(r.name ?? r.id)} ({String(r.planType ?? r.plan_type ?? "other")})
              </li>
            )
          })}
          {activePlans.length === 0 ? <li>No benefit plans yet.</li> : null}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Enroll employee</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              {activePlans.map((row) => {
                const r = row as Record<string, unknown>
                return (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    {String(r.name ?? r.id)}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
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
          <Button
            size="sm"
            disabled={
              !selectedPlanId || !selectedEmployeeId || assignEnrollment.isPending
            }
            onClick={() =>
              void run(async () => {
                await assignEnrollment.mutateAsync({
                  planId: Number(selectedPlanId),
                  employeeId: Number(selectedEmployeeId),
                })
                setSelectedEmployeeId("")
              })
            }
          >
            Assign
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Active enrollments</h3>
        <ul className="space-y-2">
          {enrolledRows.map((row) => {
            const r = row as Record<string, unknown>
            const enrollmentId = rowId(r)
            return (
              <li
                key={enrollmentId}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  Employee {rowNum(r, "employeeId", "employee_id")} → plan{" "}
                  {rowNum(r, "planId", "plan_id")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unenroll.isPending}
                  onClick={() => void run(() => unenroll.mutateAsync(enrollmentId))}
                >
                  Unenroll
                </Button>
              </li>
            )
          })}
          {enrolledRows.length === 0 ? (
            <li className="text-sm text-muted-foreground">No active enrollments.</li>
          ) : null}
        </ul>
      </section>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
