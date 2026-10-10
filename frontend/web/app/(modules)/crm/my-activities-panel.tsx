"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { Button } from "@lumiere/ui"
import { Badge } from "@lumiere/ui/components/badge"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { useActivities, useCompleteActivity } from "@lumiere/query-hooks/hooks/crm"
import { activityTargetHref, deadlineMs, isOverdue, myOpenActivities } from "./my-activities"

type Row = Record<string, unknown>

/** The signed-in user's open scheduled activities, soonest deadline first, overdue ones flagged. */
export function MyActivitiesPanel({ organizationId }: { organizationId: number }) {
  const { t, i18n } = useTranslation()
  const { identity } = useErpSession()
  const orgId = BigInt(organizationId)
  const { data: activities = [], isLoading } = useActivities(orgId)
  const completeActivity = useCompleteActivity(orgId)

  const rows = useMemo(
    () => myOpenActivities(activities as unknown as Row[], identity),
    [activities, identity],
  )
  const nowMs = Date.now()

  const complete = async (id: unknown) => {
    try {
      await completeActivity.mutateAsync(id as bigint | number | string)
    } catch (error) {
      showWorkflowToast({
        kind: "error",
        title: t("crm.chatter.markDone"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p>
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="my-activities-empty">
        {t("crm.myActivities.empty", { defaultValue: "You have no open activities." })}
      </p>
    )
  }

  return (
    <ul className="max-w-3xl space-y-2" data-testid="my-activities">
      {rows.map((row) => {
        const id = String(row.id)
        const due = deadlineMs(row.dateDeadline ?? row.date_deadline)
        const overdue = isOverdue(row, nowMs)
        const href = activityTargetHref(row)
        const model = String(row.resModel ?? row.res_model ?? "")
        const resId = row.resId ?? row.res_id
        return (
          <li
            key={id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"
            data-testid={`my-activity-${id}`}
          >
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">{String(row.summary ?? "")}</p>
              <p className="text-xs text-muted-foreground">
                {[String(row.activityType ?? row.activity_type ?? ""), due != null ? new Date(due).toLocaleDateString(i18n.language) : t("crm.myActivities.noDeadline", { defaultValue: "No deadline" })]
                  .filter(Boolean)
                  .join(" · ")}
                {model && resId != null ? (
                  <>
                    {" · "}
                    {href ? (
                      <Link className="text-primary hover:underline" href={href} data-testid={`my-activity-link-${id}`}>
                        {`${model} #${String(resId)}`}
                      </Link>
                    ) : (
                      `${model} #${String(resId)}`
                    )}
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {overdue ? (
                <Badge variant="destructive" data-testid={`my-activity-overdue-${id}`}>
                  {t("crm.myActivities.overdue", { defaultValue: "Overdue" })}
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={completeActivity.isPending}
                data-testid={`my-activity-complete-${id}`}
                onClick={() => void complete(row.id)}
              >
                {t("crm.chatter.markDone")}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
