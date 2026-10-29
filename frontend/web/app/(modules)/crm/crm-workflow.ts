import { deadlineMs, identityKey, myOpenActivities, type ActivityWorkRow } from "./my-activities"

export type CrmRecordKind = "lead" | "opportunity" | "contact"
/** The CRM read fields consumed by work queues and action eligibility. */
export interface CrmWorkRecord extends ActivityWorkRow {
  State?: unknown
  name?: unknown
  contactName?: unknown
  summary?: unknown
  activityType?: unknown
  activity_type?: unknown
  resModel?: unknown
  res_model?: unknown
  resId?: unknown
  res_id?: unknown
  isWon?: boolean
  is_won?: boolean
  isLost?: boolean
  is_lost?: boolean
  partnerId?: unknown
  partner_id?: unknown
  companyId?: unknown
  company_id?: unknown
}
type Row = CrmWorkRecord

export function crmValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object") {
    if ("some" in value) return crmValue(value.some)
    if ("none" in value) return ""
    if ("tag" in value) return String(value.tag)
  }
  return String(value)
}

export function crmLeadState(row: Row): string {
  return crmValue(row.state ?? row.State).toLowerCase()
}

export function crmOpportunityClosed(row: Row): boolean {
  return row.isWon === true || row.is_won === true || row.isLost === true || row.is_lost === true
}

export function crmOpportunityStatus(row: Row): "won" | "lost" | "open" {
  if (row.isWon === true || row.is_won === true) return "won"
  if (row.isLost === true || row.is_lost === true) return "lost"
  return "open"
}

export function crmActivityTarget(row: Row): { kind: CrmRecordKind; id: string } | undefined {
  const kind = crmValue(row.resModel ?? row.res_model).toLowerCase()
  const id = crmValue(row.resId ?? row.res_id)
  if ((kind === "lead" || kind === "opportunity" || kind === "contact") && /^[1-9]\d*$/.test(id))
    return { kind, id }
  return undefined
}

/** Dates scheduled for today stay in Today, rather than becoming overdue at midnight. */
export function crmActivityQueues(
  activities: readonly Row[],
  identity: string | null | undefined,
  now: Date,
) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const rows = myOpenActivities(activities, identity).filter((row) => crmActivityTarget(row))
  return {
    overdue: rows.filter((row) => {
      const due = deadlineMs(row.dateDeadline ?? row.date_deadline)
      return due != null && due < start
    }),
    today: rows.filter((row) => {
      const due = deadlineMs(row.dateDeadline ?? row.date_deadline)
      return due != null && due >= start && due < end
    }),
    upcoming: rows.filter((row) => {
      const due = deadlineMs(row.dateDeadline ?? row.date_deadline)
      return due == null || due >= end
    }),
  }
}

/** Only the signed-in owner's open deals; missing owners never imply personal ownership. */
export function crmDealsNeedingAttention(
  opportunities: readonly Row[],
  activities: readonly Row[],
  identity: string | null | undefined,
  now: Date,
  companyId: bigint,
): Row[] {
  const me = identityKey(identity)
  if (!me || companyId === 0n) return []
  const scheduled = new Set(
    activities
      .filter(
        (row) =>
          row.isDone !== true &&
          row.is_done !== true &&
          crmValue(row.state).toLowerCase() !== "done" &&
          !deadlineMs(row.deletedAt ?? row.deleted_at),
      )
      .map(crmActivityTarget)
      .filter((target) => target?.kind === "opportunity")
      .map((target) => target!.id),
  )
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return opportunities
    .filter((row) => {
      if (
        identityKey(row.userId ?? row.user_id) !== me ||
        crmOpportunityClosed(row) ||
        deadlineMs(row.deletedAt ?? row.deleted_at)
      )
        return false
      if (crmValue(row.companyId ?? row.company_id) !== String(companyId)) return false
      const due = deadlineMs(row.dateDeadline ?? row.date_deadline)
      return (due != null && due < start) || !scheduled.has(crmValue(row.id))
    })
    .sort(
      (a, b) =>
        (deadlineMs(a.dateDeadline ?? a.date_deadline) ?? Infinity) -
        (deadlineMs(b.dateDeadline ?? b.date_deadline) ?? Infinity),
    )
}

export type CrmActionId =
  | "qualify"
  | "convertLead"
  | "changeStage"
  | "won"
  | "lost"
  | "createOrder"
  | "followUp"
  | "edit"
export interface CrmActionContext {
  ready: boolean
  canWrite: boolean
  canCreateActivity: boolean
  canConvertLead: boolean
  busy: boolean
  companyReady: boolean
  stagesReady: boolean
  wonStageReady: boolean
  lostReasonsReady: boolean
  orderSetupReady: boolean
  activityTypesReady: boolean
}

/** Every disabled action carries a user-facing explanation. Server permissions remain authoritative. */
export function crmWorkflowActions(
  kind: CrmRecordKind,
  row: Row,
  context: CrmActionContext,
): { id: CrmActionId; reason?: string }[] {
  const ids: CrmActionId[] =
    kind === "lead"
      ? [
          ...(crmLeadState(row) === "new" ? ["qualify" as const] : []),
          ...(crmLeadState(row) === "qualified" ? ["convertLead" as const] : []),
          "followUp",
          "edit",
        ]
      : kind === "opportunity"
        ? [
            ...(!crmOpportunityClosed(row)
              ? ["changeStage" as const, "won" as const, "lost" as const]
              : []),
            ...(crmOpportunityStatus(row) !== "lost" ? ["createOrder" as const] : []),
            "followUp",
            "edit",
          ]
        : ["followUp", "edit"]
  return ids.map((id) => {
    let reason: string | undefined
    if (!context.ready) reason = "sourceUnavailable"
    else if (id === "followUp" ? !context.canCreateActivity : !context.canWrite)
      reason = "permissionRequired"
    else if (context.busy) reason = "saving"
    else if ((kind === "opportunity" || id === "convertLead") && !context.companyReady)
      reason = "companyRequired"
    else if (id === "convertLead" && !context.canConvertLead)
      reason = "conversionPermissionRequired"
    else if ((id === "changeStage" || id === "convertLead") && !context.stagesReady)
      reason = "stagesRequired"
    else if (id === "won" && !context.wonStageReady) reason = "wonStageRequired"
    else if (id === "lost" && !context.lostReasonsReady) reason = "lostReasonRequired"
    else if (id === "createOrder" && !crmValue(row.partnerId ?? row.partner_id))
      reason = "customerRequired"
    else if (id === "createOrder" && !context.orderSetupReady) reason = "orderSetupRequired"
    else if (id === "followUp" && !context.activityTypesReady) reason = "activityTypeRequired"
    return { id, reason }
  })
}
