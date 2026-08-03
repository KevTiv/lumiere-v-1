"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { stdbBrowserQuery } from "@lumiere/stdb/browser-http"
import {
  subscribeToRecord,
  unsubscribeFromRecord,
} from "@lumiere/stdb/client-ui-bridge"
import { usePostMessage } from "@lumiere/query-hooks/hooks/messages"
import {
  useCompleteActivity,
  useCreateActivity,
} from "@lumiere/query-hooks/hooks/crm"
import { finalizeCreateActivityParams } from "@lumiere/query-hooks/hooks/crm-params-merge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  formatTimelineDate,
  mergeRecordTimeline,
  type TimelineEntry,
} from "./crm-record-timeline"

const FOLLOW_SUBTYPES = ["comment", "note"] as const

const ACTIVITY_TYPES = ["call", "email", "meeting", "todo"] as const

function identityHex(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.toLowerCase()
  if (typeof v === "object" && v !== null && "toHex" in v) {
    const th = (v as { toHex: () => { toString: () => string } }).toHex
    if (typeof th === "function") return th.call(v).toString().toLowerCase()
  }
  return String(v).toLowerCase()
}

function messageTypeLabel(v: unknown): string {
  const s = String(v ?? "").toLowerCase()
  if (s === "note") return "note"
  if (s === "comment") return "comment"
  if (s === "email") return "email"
  if (s === "notification" || s === "user_notification") return "notification"
  return s || "message"
}

function parseAttachmentIds(raw: string): bigint[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => BigInt(part))
}

/**
 * CRM-RI-015: maps this component's free-text `resModel` host record onto the
 * backend's typed `CrmActivityTarget`. The chatter is mounted on records
 * outside that enum (e.g. `activity` itself), so an unsupported model yields
 * `undefined` — a legitimately unattached activity — rather than a rejected write.
 */
function crmActivityTargetFor(
  resModel: string,
  resId: bigint,
): { tag: "Contact" | "Lead" | "Opportunity"; value: bigint } | undefined {
  switch (resModel.trim().toLowerCase()) {
    case "contact":
      return { tag: "Contact", value: resId }
    case "lead":
      return { tag: "Lead", value: resId }
    case "opportunity":
      return { tag: "Opportunity", value: resId }
    default:
      return undefined
  }
}

export interface CrmRecordChatterProps {
  organizationId: number
  /** SpacetimeDB polymorphic model, e.g. `lead`, `contact`, `opportunity`, `activity` */
  resModel: string
  resId: bigint
  recordTitle?: string
  className?: string
}

export function CrmRecordChatter({
  organizationId,
  resModel,
  resId,
  recordTitle,
  className,
}: CrmRecordChatterProps) {
  const { t } = useTranslation()
  const { identity } = useErpSession()
  const org = BigInt(organizationId)
  const postMessage = usePostMessage(org)
  const createActivity = useCreateActivity(org)
  const completeActivity = useCompleteActivity(org)

  const [noteBody, setNoteBody] = useState("")
  const [attachmentIdsRaw, setAttachmentIdsRaw] = useState("")
  const [activitySummary, setActivitySummary] = useState("")
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]>("todo")
  const [activityDeadline, setActivityDeadline] = useState("")
  const [activityNote, setActivityNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<
    Array<{ id: bigint; body: string; messageType: unknown; date: unknown }>
  >([])
  const [activities, setActivities] = useState<
    Array<{
      id: bigint
      summary: string
      note: string | null | undefined
      activityType: string
      isDone: boolean
      createdAt: unknown
      dateDeadline: unknown
    }>
  >([])
  const [following, setFollowing] = useState(false)

  const reloadMessages = useCallback(() => {
    if (!organizationId || !resModel) {
      setMessages([])
      return
    }
    ;(async () => {
      try {
        const list = await stdbBrowserQuery("mail-messages")
        const filtered = list.filter((m) => {
          const row = m as { organizationId: unknown; model: string; resId: unknown }
          return (
            Number(row.organizationId) === organizationId &&
            row.model === resModel &&
            BigInt(String(row.resId ?? 0)) === resId
          )
        })
        const mapped = filtered
          .map((m) => {
            const row = m as { id: unknown; body: string; messageType: unknown; date: unknown }
            return {
              id: BigInt(String(row.id ?? 0)),
              body: row.body,
              messageType: row.messageType,
              date: row.date,
            }
          })
          .sort((a, b) => Number(b.date ?? 0) - Number(a.date ?? 0))
        setMessages(mapped)
      } catch {
        setMessages([])
      }
    })()
  }, [organizationId, resModel, resId])

  const reloadActivities = useCallback(() => {
    if (!organizationId || !resModel) {
      setActivities([])
      return
    }
    ;(async () => {
      try {
        const list = await stdbBrowserQuery("activities")
        const filtered = list.filter((a) => {
          const row = a as {
            organizationId: unknown
            resModel: string | null | undefined
            resId: unknown
          }
          return (
            Number(row.organizationId) === organizationId &&
            row.resModel === resModel &&
            BigInt(String(row.resId ?? 0)) === resId
          )
        })
        const mapped = filtered.map((a) => {
          const row = a as {
            id: unknown
            summary: string
            note: string | null | undefined
            activityType: string
            isDone: boolean
            createdAt: unknown
            dateDeadline: unknown
          }
          return {
            id: BigInt(String(row.id ?? 0)),
            summary: row.summary,
            note: row.note,
            activityType: row.activityType,
            isDone: Boolean(row.isDone),
            createdAt: row.createdAt,
            dateDeadline: row.dateDeadline,
          }
        })
        setActivities(mapped)
      } catch {
        setActivities([])
      }
    })()
  }, [organizationId, resModel, resId])

  const reloadFollower = useCallback(() => {
    if (!identity || !organizationId || !resModel) {
      setFollowing(false)
      return
    }
    ;(async () => {
      try {
        const list = await stdbBrowserQuery("mail-followers")
        const me = identity.toLowerCase()
        const found = list.some((f) => {
          const row = f as {
            organizationId: unknown
            resModel: string
            resId: unknown
            partnerId: unknown
          }
          return (
            Number(row.organizationId) === organizationId &&
            row.resModel === resModel &&
            BigInt(String(row.resId ?? 0)) === resId &&
            identityHex(row.partnerId) === me
          )
        })
        setFollowing(found)
      } catch {
        setFollowing(false)
      }
    })()
  }, [organizationId, resModel, resId, identity])

  useEffect(() => {
    reloadMessages()
    reloadActivities()
    reloadFollower()
  }, [reloadMessages, reloadActivities, reloadFollower])

  const timeline = useMemo(
    () => mergeRecordTimeline(messages, activities),
    [messages, activities],
  )

  const postNote = async () => {
    const body = noteBody.trim()
    if (!body || !identity) return
    let attachmentIds: bigint[] = []
    if (attachmentIdsRaw.trim()) {
      try {
        attachmentIds = parseAttachmentIds(attachmentIdsRaw)
      } catch {
        window.alert(t("crm.chatter.attachmentIdsInvalid"))
        return
      }
    }
    try {
      setBusy(true)
      await postMessage.mutateAsync({
        model: resModel,
        resId,
        body,
        messageType: attachmentIds.length > 0 ? "comment" : "note",
        parentId: null,
        attachmentIds,
      })
      setNoteBody("")
      setAttachmentIdsRaw("")
      reloadMessages()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const logActivity = async () => {
    const summary = activitySummary.trim()
    if (!summary || !activityDeadline) return
    const d = new Date(activityDeadline)
    if (Number.isNaN(d.getTime())) return
    try {
      setBusy(true)
      const params = finalizeCreateActivityParams({
        activityType,
        summary,
        note: activityNote.trim() || undefined,
        dateDeadline: stbTimestampFromDate(d),
        // CRM-RI-015: activities take a typed, server-validated target. Only
        // these three CRM entities are supported by the backend
        // `CrmActivityTarget` enum; for any other host record the activity is
        // logged unattached rather than sent with a value that cannot persist.
        target: crmActivityTargetFor(resModel, resId),
      })
      await createActivity.mutateAsync(params)
      setActivitySummary("")
      setActivityNote("")
      setActivityDeadline("")
      setActivityType("todo")
      reloadActivities()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const markActivityDone = async (activityId: bigint) => {
    try {
      setBusy(true)
      await completeActivity.mutateAsync(activityId)
      reloadActivities()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleFollow = async () => {
    if (!identity) return
    try {
      setBusy(true)
      if (following) {
        await unsubscribeFromRecord(org, resModel, resId)
      } else {
        await subscribeToRecord(org, resModel, resId, [...FOLLOW_SUBTYPES])
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      reloadFollower()
    }
  }

  const heading = useMemo(() => {
    if (recordTitle?.trim()) return recordTitle.trim()
    return `${resModel} #${resId.toString()}`
  }, [recordTitle, resModel, resId])

  if (!organizationId) {
    return <p className="text-sm text-muted-foreground">{t("crm.chatter.needOrg")}</p>
  }

  if (!identity) {
    return <p className="text-sm text-muted-foreground">{t("crm.chatter.needConnection")}</p>
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !identity}
          data-testid="record-chatter-follow"
          onClick={() => void toggleFollow()}
        >
          {following ? t("crm.chatter.unfollow") : t("crm.chatter.follow")}
        </Button>
      </div>

      <div className="space-y-2">
        <Textarea
          placeholder={t("crm.chatter.notePlaceholder")}
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          rows={3}
          className="resize-y min-h-[4.5rem]"
          data-testid="record-chatter-note"
        />
        <input
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          placeholder={t("crm.chatter.attachmentIdsPlaceholder")}
          value={attachmentIdsRaw}
          onChange={(e) => setAttachmentIdsRaw(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !noteBody.trim()}
          data-testid="record-chatter-post"
          onClick={() => void postNote()}
        >
          {t("crm.chatter.postNote")}
        </Button>
      </div>

      <div className="space-y-3 rounded-md border p-3 bg-muted/20">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("crm.chatter.logActivity")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="chatter-activity-summary">{t("crm.chatter.activitySummary")}</Label>
            <Input
              id="chatter-activity-summary"
              value={activitySummary}
              onChange={(e) => setActivitySummary(e.target.value)}
              placeholder={t("crm.chatter.activitySummaryPlaceholder")}
              data-testid="record-chatter-activity-summary"
            />
          </div>
          <div className="space-y-1">
            <Label>{t("crm.chatter.activityType")}</Label>
            <Select value={activityType} onValueChange={(v) => setActivityType(v as typeof activityType)}>
              <SelectTrigger data-testid="record-chatter-activity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`crm.chatter.activityTypes.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="chatter-activity-deadline">{t("crm.chatter.activityDeadline")}</Label>
            <Input
              id="chatter-activity-deadline"
              type="date"
              value={activityDeadline}
              onChange={(e) => setActivityDeadline(e.target.value)}
              data-testid="record-chatter-activity-deadline"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="chatter-activity-note">{t("crm.chatter.activityNote")}</Label>
            <Textarea
              id="chatter-activity-note"
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
              rows={2}
              placeholder={t("crm.chatter.activityNotePlaceholder")}
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !activitySummary.trim() || !activityDeadline}
          data-testid="record-chatter-log-activity"
          onClick={() => void logActivity()}
        >
          {t("crm.chatter.scheduleActivity")}
        </Button>
      </div>

      <div className="border-t pt-3 space-y-2 max-h-72 overflow-y-auto">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("crm.chatter.timeline")}
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("crm.chatter.noTimeline")}</p>
        ) : (
          <ul className="space-y-2">
            {timeline.map((entry) => (
              <TimelineItem
                key={entry.kind === "message" ? entry.id : `act-${entry.id.toString()}`}
                entry={entry}
                busy={busy}
                onComplete={(id) => void markActivityDone(id)}
                t={t}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function TimelineItem({
  entry,
  busy,
  onComplete,
  t,
}: {
  entry: TimelineEntry
  busy: boolean
  onComplete: (id: bigint) => void
  t: (key: string) => string
}) {
  if (entry.kind === "message") {
    return (
      <li className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
          <span className="uppercase">{messageTypeLabel(entry.messageType)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words">{entry.body}</p>
      </li>
    )
  }

  return (
    <li
      className="rounded-md border bg-background px-3 py-2 text-sm"
      data-testid={`record-chatter-activity-${entry.id.toString()}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase text-[10px]">
            {t(`crm.chatter.activityTypes.${entry.activityType}`) || entry.activityType}
          </Badge>
          {entry.isDone ? (
            <Badge variant="secondary" className="text-[10px]">
              {t("crm.chatter.activityDone")}
            </Badge>
          ) : (
            <Badge variant="default" className="text-[10px]">
              {t("crm.chatter.activityPlanned")}
            </Badge>
          )}
        </div>
        {entry.dateDeadline ? (
          <span>{formatTimelineDate(entry.dateDeadline)}</span>
        ) : null}
      </div>
      <p className="font-medium">{entry.summary}</p>
      {entry.note ? (
        <p className="text-muted-foreground whitespace-pre-wrap break-words mt-1">{entry.note}</p>
      ) : null}
      {!entry.isDone ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 h-7 text-xs"
          disabled={busy}
          data-testid={`record-chatter-complete-${entry.id.toString()}`}
          onClick={() => onComplete(entry.id)}
        >
          {t("crm.chatter.markDone")}
        </Button>
      ) : null}
    </li>
  )
}

export interface CrmRecordChatterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: number
  resModel: string
  resId: bigint
  recordTitle?: string
}

export function CrmRecordChatterDialog({
  open,
  onOpenChange,
  organizationId,
  resModel,
  resId,
  recordTitle,
}: CrmRecordChatterDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="record-chatter-dialog">
        <DialogHeader>
          <DialogTitle>{t("crm.chatter.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <CrmRecordChatter
          organizationId={organizationId}
          resModel={resModel}
          resId={resId}
          recordTitle={recordTitle}
        />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Generic aliases — same component, usable outside CRM modules. */
export type RecordChatterProps = CrmRecordChatterProps
export const RecordChatter = CrmRecordChatter

export type RecordChatterDialogProps = CrmRecordChatterDialogProps
export const RecordChatterDialog = CrmRecordChatterDialog
