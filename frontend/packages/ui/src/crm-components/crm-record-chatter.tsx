"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  getStdbConnection,
  postInternalNote,
  subscribeToRecord,
  unsubscribeFromRecord,
  useStdbConnection,
} from "@lumiere/stdb"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const FOLLOW_SUBTYPES = ["comment", "note"] as const

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
  const { connected, identity } = useStdbConnection()
  const org = BigInt(organizationId)

  const [noteBody, setNoteBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<
    Array<{ id: bigint; body: string; messageType: unknown; date: unknown }>
  >([])
  const [following, setFollowing] = useState(false)

  const reloadMessages = useCallback(() => {
    const conn = getStdbConnection()
    if (!conn || !organizationId || !resModel) {
      setMessages([])
      return
    }
    const list = [...conn.db.mail_message.iter()].filter((m) => {
      const row = m as {
        organizationId: bigint
        model: string
        resId: bigint
      }
      return (
        Number(row.organizationId) === organizationId &&
        row.model === resModel &&
        row.resId === resId
      )
    })
    const mapped = list
      .map((m) => {
        const row = m as { id: bigint; body: string; messageType: unknown; date: unknown }
        return { id: row.id, body: row.body, messageType: row.messageType, date: row.date }
      })
      .sort((a, b) => Number(b.date ?? 0) - Number(a.date ?? 0))
    setMessages(mapped)
  }, [organizationId, resModel, resId])

  const reloadFollower = useCallback(() => {
    const conn = getStdbConnection()
    if (!conn || !identity || !organizationId || !resModel) {
      setFollowing(false)
      return
    }
    const me = identity.toLowerCase()
    const found = [...conn.db.mail_follower.iter()].some((f) => {
      const row = f as {
        organizationId: bigint
        resModel: string
        resId: bigint
        partnerId: unknown
      }
      return (
        Number(row.organizationId) === organizationId &&
        row.resModel === resModel &&
        row.resId === resId &&
        identityHex(row.partnerId) === me
      )
    })
    setFollowing(found)
  }, [organizationId, resModel, resId, identity])

  useEffect(() => {
    reloadMessages()
    reloadFollower()
  }, [reloadMessages, reloadFollower])

  const postNote = async () => {
    const body = noteBody.trim()
    if (!body || !connected) return
    try {
      setBusy(true)
      await postInternalNote(org, resModel, resId, body)
      setNoteBody("")
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleFollow = async () => {
    if (!connected || !identity) return
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
    }
  }

  const heading = useMemo(() => {
    if (recordTitle?.trim()) return recordTitle.trim()
    return `${resModel} #${resId.toString()}`
  }, [recordTitle, resModel, resId])

  if (!organizationId) {
    return <p className="text-sm text-muted-foreground">{t("crm.chatter.needOrg")}</p>
  }

  if (!connected) {
    return <p className="text-sm text-muted-foreground">{t("crm.chatter.needConnection")}</p>
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
        <Button type="button" variant="outline" size="sm" disabled={busy || !identity} onClick={() => void toggleFollow()}>
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
        />
        <Button type="button" size="sm" disabled={busy || !noteBody.trim()} onClick={() => void postNote()}>
          {t("crm.chatter.postNote")}
        </Button>
      </div>

      <div className="border-t pt-3 space-y-2 max-h-64 overflow-y-auto">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("crm.chatter.timeline")}
        </p>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("crm.chatter.noMessages")}</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={String(m.id)} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
                  <span className="uppercase">{messageTypeLabel(m.messageType)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
