"use client"

import { useState } from "react"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
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

const PLAN_TYPES = ["health", "dental", "retirement", "other"] as const

/** HR module tab — persisted benefit plans and employee enrollments. */
export function HrBenefitsPanel({ organizationId, companyId, employees }: HrBenefitsPanelProps) {
  const { t } = useTranslation()
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

  const planTypeLabels: Record<(typeof PLAN_TYPES)[number], string> = {
    health: t("hr.benefits.planTypes.health", { defaultValue: "Health" }),
    dental: t("hr.benefits.planTypes.dental", { defaultValue: "Dental" }),
    retirement: t("hr.benefits.planTypes.retirement", {
      defaultValue: "Retirement",
    }),
    other: t("hr.benefits.planTypes.other", { defaultValue: "Other" }),
  }

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("hr.benefits.actionFailed", { defaultValue: "Action failed" }))
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
        <h3 className="text-sm font-medium">{t("hr.benefits.plans.title", { defaultValue: "Benefit plans" })}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="max-w-xs"
            placeholder={t("hr.benefits.plans.namePlaceholder", {
              defaultValue: "Plan name",
            })}
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
          />
          <Select value={planType} onValueChange={setPlanType}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_TYPES.map((planTypeValue) => (
                <SelectItem key={planTypeValue} value={planTypeValue}>
                  {planTypeLabels[planTypeValue]}
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
            {t("hr.benefits.plans.create", { defaultValue: "Create plan" })}
          </Button>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1">
          {activePlans.slice(0, 8).map((row) => {
            const r = row as Record<string, unknown>
            return (
              <li key={String(r.id)}>
                {String(r.name ?? r.id)} (
                {planTypeLabels[String(r.planType ?? r.plan_type ?? "other") as keyof typeof planTypeLabels] ??
                  String(r.planType ?? r.plan_type ?? "other")}
                )
              </li>
            )
          })}
          {activePlans.length === 0 ? (
            <li>
              {t("hr.benefits.plans.empty", {
                defaultValue: "No benefit plans yet.",
              })}
            </li>
          ) : null}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("hr.benefits.enroll.title", { defaultValue: "Enroll employee" })}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue
                placeholder={t("hr.benefits.planPlaceholder", {
                  defaultValue: "Plan",
                })}
              />
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
              <SelectValue
                placeholder={t("hr.benefits.employeePlaceholder", {
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
          <Button
            size="sm"
            disabled={!selectedPlanId || !selectedEmployeeId || assignEnrollment.isPending}
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
            {t("hr.benefits.enroll.assign", { defaultValue: "Assign" })}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          {t("hr.benefits.enroll.activeTitle", {
            defaultValue: "Active enrollments",
          })}
        </h3>
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
                  {t("hr.benefits.enroll.summary", {
                    defaultValue: "Employee {{employeeId}} → plan {{planId}}",
                    employeeId: rowNum(r, "employeeId", "employee_id"),
                    planId: rowNum(r, "planId", "plan_id"),
                  })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unenroll.isPending}
                  onClick={() => void run(() => unenroll.mutateAsync(enrollmentId))}
                >
                  {t("hr.benefits.enroll.unenroll", {
                    defaultValue: "Unenroll",
                  })}
                </Button>
              </li>
            )
          })}
          {enrolledRows.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              {t("hr.benefits.enroll.empty", {
                defaultValue: "No active enrollments.",
              })}
            </li>
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
