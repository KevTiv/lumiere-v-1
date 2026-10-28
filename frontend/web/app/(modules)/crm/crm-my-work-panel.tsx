"use client"

import { useEffect, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Badge } from "@lumiere/ui/components/badge"
import { useCompleteActivity } from "@lumiere/query-hooks/hooks/crm"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import {
  crmActivityQueues,
  crmActivityTarget,
  crmDealsNeedingAttention,
  crmValue,
  type CrmRecordKind,
  type CrmWorkRecord,
} from "./crm-workflow"
import { deadlineMs } from "./my-activities"

type Row = CrmWorkRecord
interface Collection {
  rows: Row[]
  state: ModuleDataState
}
interface Props {
  organizationId: number
  companyId: bigint
  activities: Collection
  opportunities: Collection
  leads: Collection
  contacts: Collection
  canComplete: boolean
  canCreateLead: boolean
  onCreateLead: () => void
  onOpenRecord: (kind: CrmRecordKind, id: string) => void
}

function SourceNotice({ state }: { state: ModuleDataState }) {
  const { t } = useTranslation()
  if (state.status === "ready") return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <p>{t(`crm.myWork.source.${state.status}`)}</p>
      {"onRetry" in state && state.onRetry && (
        <Button size="sm" variant="outline" onClick={state.onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  )
}

export function CrmMyWorkPanel(props: Props) {
  const { t, i18n } = useTranslation()
  const { identity } = useErpSession()
  const completeActivity = useCompleteActivity(BigInt(props.organizationId))
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const queues = crmActivityQueues(props.activities.rows, identity, now)
  const deals = crmDealsNeedingAttention(
    props.opportunities.rows,
    props.activities.rows,
    identity,
    now,
    props.companyId,
  )
  const recordCollection = {
    lead: props.leads,
    opportunity: props.opportunities,
    contact: props.contacts,
  }
  const complete = async (row: Row) => {
    if (
      !props.canComplete ||
      props.activities.state.status !== "ready" ||
      completeActivity.isPending
    )
      return
    try {
      await completeActivity.mutateAsync(String(row.id))
      showWorkflowToast({ kind: "success", title: t("crm.workflow.feedback.activityCompleted") })
    } catch (error) {
      showWorkflowToast({
        kind: "error",
        title: t("crm.workflow.feedback.activityFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return (
    <div className="space-y-6" data-testid="crm-my-work">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold">{t("crm.myWork.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("crm.myWork.description")}</p>
        </div>
        {props.canCreateLead && (
          <Button onClick={props.onCreateLead} disabled={props.leads.state.status !== "ready"}>
            {t("crm.workflow.newLead")}
          </Button>
        )}
      </div>
      <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
        {t("crm.workflow.lifecycle")}
      </p>
      {props.activities.state.status !== "ready" ? (
        <SourceNotice state={props.activities.state} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {(["overdue", "today", "upcoming"] as const).map((queue) => (
            <section
              key={queue}
              className="min-w-0 space-y-3 rounded-lg border p-4"
              aria-label={t(`crm.myWork.${queue}`)}
            >
              <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">
                {t(`crm.myWork.${queue}`)}
                <Badge
                  variant={
                    queue === "overdue" && queues[queue].length ? "destructive" : "secondary"
                  }
                >
                  {queues[queue].length}
                </Badge>
              </h3>
              {queues[queue].length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(`crm.myWork.empty.${queue}`)}</p>
              ) : (
                <ul className="space-y-3">
                  {queues[queue].map((row) => {
                    const target = crmActivityTarget(row)!
                    const source = recordCollection[target.kind]
                    const record =
                      source.state.status === "ready"
                        ? source.rows.find((record) => crmValue(record.id) === target.id)
                        : undefined
                    const label = record
                      ? crmValue(record.name ?? record.contactName)
                      : t(`crm.workflow.recordKinds.${target.kind}`)
                    const due = deadlineMs(row.dateDeadline ?? row.date_deadline)
                    return (
                      <li key={crmValue(row.id)} className="space-y-2 rounded-md bg-muted/30 p-3">
                        <p className="break-words text-sm font-medium">{crmValue(row.summary)}</p>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto max-w-full justify-start whitespace-normal p-0 text-left"
                          disabled={!record}
                          onClick={() => props.onOpenRecord(target.kind, target.id)}
                        >
                          {label}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {[
                            crmValue(row.activityType ?? row.activity_type),
                            due == null
                              ? t("crm.myActivities.noDeadline")
                              : new Date(due).toLocaleDateString(i18n.language),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {!record && (
                          <p className="text-xs text-muted-foreground">
                            {t("crm.myWork.recordUnavailable")}
                          </p>
                        )}
                        {props.canComplete && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={completeActivity.isPending}
                            onClick={() => void complete(row)}
                          >
                            {t("crm.chatter.markDone")}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      <section className="space-y-3 rounded-lg border p-4" aria-label={t("crm.myWork.deals")}>
        <h3 className="text-sm font-semibold">{t("crm.myWork.deals")}</h3>
        <p className="text-sm text-muted-foreground">{t("crm.myWork.dealsHint")}</p>
        {props.opportunities.state.status !== "ready" ? (
          <SourceNotice state={props.opportunities.state} />
        ) : props.activities.state.status !== "ready" ? (
          <SourceNotice state={props.activities.state} />
        ) : !identity || props.companyId === 0n ? (
          <p className="text-sm text-muted-foreground">
            {t("crm.workflow.reasons.companyRequired")}
          </p>
        ) : deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("crm.myWork.empty.deals")}</p>
        ) : (
          <ul className="divide-y">
            {deals.map((row) => (
              <li key={crmValue(row.id)} className="py-2">
                <Button
                  variant="link"
                  className="h-auto whitespace-normal p-0 text-left"
                  onClick={() => props.onOpenRecord("opportunity", crmValue(row.id))}
                >
                  {crmValue(row.name)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
