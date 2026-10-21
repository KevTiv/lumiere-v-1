"use client"

import { useMemo, useState } from "react"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import type { QueryRows } from "@lumiere/query-hooks/http"
import {
  useApplicants,
  useCreateHrApplicant,
  useJobPositions,
  useUpdateHrApplicant,
} from "@lumiere/query-hooks/hooks/hr"

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const

function rowId(row: Record<string, unknown>): number {
  return Number(row.id ?? row.Id ?? 0)
}

interface HrRecruitmentPanelProps {
  organizationId: bigint
  companyId: bigint
}

/** Recruitment tab — open positions and the persisted applicant pipeline. */
export function HrRecruitmentPanel({ organizationId, companyId }: HrRecruitmentPanelProps) {
  const { t } = useTranslation()
  const { data: jobs = [] } = useJobPositions(organizationId)
  const { data: applicants = [] } = useApplicants(organizationId)
  const createApplicant = useCreateHrApplicant(organizationId, companyId)
  const updateApplicant = useUpdateHrApplicant(organizationId, companyId)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [jobId, setJobId] = useState("")
  const [error, setError] = useState<string | null>(null)

  const stageLabels: Record<(typeof STAGES)[number], string> = {
    applied: t("hr.recruitment.stages.applied", { defaultValue: "Applied" }),
    screening: t("hr.recruitment.stages.screening", {
      defaultValue: "Screening",
    }),
    interview: t("hr.recruitment.stages.interview", {
      defaultValue: "Interview",
    }),
    offer: t("hr.recruitment.stages.offer", { defaultValue: "Offer" }),
    hired: t("hr.recruitment.stages.hired", { defaultValue: "Hired" }),
    rejected: t("hr.recruitment.stages.rejected", { defaultValue: "Rejected" }),
  }

  const recruitJobs = useMemo(
    () => (jobs as QueryRows).filter((j) => String((j as Record<string, unknown>).state ?? "") === "recruit"),
    [jobs],
  )

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("hr.recruitment.actionFailed", { defaultValue: "Action failed" }))
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          {t("hr.recruitment.openPositions", {
            defaultValue: "Open positions (recruit)",
          })}
        </h3>
        {recruitJobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("hr.recruitment.noOpenPositions", {
              defaultValue: "No positions in recruit state.",
            })}
          </p>
        ) : (
          <ul className="text-sm space-y-1">
            {recruitJobs.map((j) => {
              const row = j as Record<string, unknown>
              return (
                <li key={rowId(row)}>
                  {String(row.name ?? "—")} (#{rowId(row)})
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">{t("hr.recruitment.addApplicant", { defaultValue: "Add applicant" })}</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <Input
            placeholder={t("hr.recruitment.namePlaceholder", {
              defaultValue: "Name",
            })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          <Input
            placeholder={t("hr.recruitment.emailPlaceholder", {
              defaultValue: "Email",
            })}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="max-w-xs"
          />
          <Select value={jobId} onValueChange={setJobId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue
                placeholder={t("hr.recruitment.jobPlaceholder", {
                  defaultValue: "Job position",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {recruitJobs.map((j) => {
                const row = j as Record<string, unknown>
                const id = rowId(row)
                return (
                  <SelectItem key={id} value={String(id)}>
                    {String(row.name ?? id)}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Button
            disabled={!name.trim() || !jobId || createApplicant.isPending}
            onClick={() =>
              run(async () => {
                await createApplicant.mutateAsync({
                  jobPositionId: BigInt(jobId),
                  name: name.trim(),
                  email: email.trim() || undefined,
                  stage: "applied",
                })
                setName("")
                setEmail("")
              })
            }
          >
            {t("hr.recruitment.add", { defaultValue: "Add" })}
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">
          {t("hr.recruitment.applicantCount", {
            defaultValue: "Applicants ({{count}})",
            count: (applicants as QueryRows).length,
          })}
        </h3>
        {(applicants as QueryRows).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("hr.recruitment.noApplicants", {
              defaultValue: "No applicants yet.",
            })}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(applicants as QueryRows).map((a) => {
              const row = a as Record<string, unknown>
              const id = rowId(row)
              const stage = String(row.stage ?? "applied")
              return (
                <li key={id} className="flex flex-wrap items-center gap-2 justify-between border rounded-md px-3 py-2">
                  <span>
                    {String(row.name ?? "—")}
                    {row.email ? ` · ${String(row.email)}` : ""}
                    {" · "}
                    {t("hr.recruitment.jobReference", {
                      defaultValue: "job #{{id}}",
                      id: String(row.job_position_id ?? row.jobPositionId ?? "—"),
                    })}
                  </span>
                  <Select
                    value={stage}
                    onValueChange={(next) =>
                      run(async () => {
                        await updateApplicant.mutateAsync({
                          applicantId: BigInt(id),
                          stage: next,
                        })
                      })
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {stageLabels[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
