"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Pencil, ShieldAlert, X } from "lucide-react"
import type { ChatActionDraftPayload } from "@/lib/ai-chat-types"
import { AiActionDraftDiffPanel } from "./ai-action-draft-diff-panel"

interface AiActionDraftCardProps {
  draft: ChatActionDraftPayload
  onApprove?: (draft: ChatActionDraftPayload) => Promise<void>
  onReject?: (draft: ChatActionDraftPayload, reason?: string) => Promise<void>
  onUpdateDraft?: (draft: ChatActionDraftPayload) => Promise<void>
}

function reducerLabel(name: string): string {
  return name.replace(/_/g, " ")
}

export function AiActionDraftCard({
  draft,
  onApprove,
  onReject,
  onUpdateDraft,
}: AiActionDraftCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editJson, setEditJson] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmedElevated, setConfirmedElevated] = useState(false)
  const [confirmedReview, setConfirmedReview] = useState(false)
  const [busy, setBusy] = useState<"approve" | "reject" | "save" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const status = draft.status ?? "pending"
  const isPending = status === "pending"
  const paramsPreview = JSON.stringify(draft.paramsJson, null, 2)

  useEffect(() => {
    setEditJson(paramsPreview)
    setEditError(null)
    setConfirmedReview(false)
    setConfirmedElevated(false)
  }, [draft.draftId, paramsPreview])

  const canApprove =
    isPending &&
    confirmedReview &&
    (!draft.elevated || confirmedElevated) &&
    (!editing || editJson === paramsPreview)

  const handleSaveParams = async () => {
    if (!onUpdateDraft || !isPending) return
    setEditError(null)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(editJson) as Record<string, unknown>
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Parameters must be a JSON object")
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Invalid JSON")
      return
    }

    setBusy("save")
    setError(null)
    try {
      await onUpdateDraft({ ...draft, paramsJson: parsed })
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleApprove = async () => {
    if (!onApprove || !isPending || !canApprove) return
    setBusy("approve")
    setError(null)
    try {
      await onApprove(draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleReject = async () => {
    if (!onReject || !isPending) return
    setBusy("reject")
    setError(null)
    try {
      await onReject(draft, "Rejected from chat")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      data-testid={`ai-action-draft-card-${draft.draftId}`}
      className={cn(
        "rounded-lg border text-xs",
        draft.elevated ? "border-warning/40 bg-warning/5" : "border-border bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 capitalize">
              {reducerLabel(draft.reducerName)}
            </Badge>
            <Badge
              variant={
                status === "approved"
                  ? "default"
                  : status === "rejected"
                    ? "secondary"
                    : status === "failed"
                      ? "destructive"
                      : "outline"
              }
              className="text-[9px] h-4 px-1.5 capitalize"
            >
              {status}
            </Badge>
            {draft.confidence > 0 ? (
              <span className="text-[9px] text-muted-foreground">
                {Math.round(draft.confidence * 100)}% confidence
              </span>
            ) : null}
          </div>

          <p className="text-xs leading-snug">{draft.summary}</p>

          {draft.sourceQuery ? (
            <p className="text-[10px] text-muted-foreground line-clamp-2">
              Request: {draft.sourceQuery}
            </p>
          ) : null}

          {draft.expiresAt && (draft.status ?? "pending") === "pending" ? (
            <p className="text-[10px] text-muted-foreground">
              Expires {new Date(draft.expiresAt).toLocaleString()}
            </p>
          ) : null}

          {draft.elevated ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[10px] text-warning">
                <ShieldAlert className="h-3 w-3 shrink-0" />
                <span>Elevated action — review parameters carefully before approving.</span>
              </div>
              {isPending ? (
                <label className="flex items-start gap-2 text-[10px] text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={confirmedElevated}
                    onCheckedChange={(checked) => setConfirmedElevated(checked === true)}
                    className="mt-0.5"
                  />
                  <span>I have reviewed the parameters and approve this elevated action.</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {draft.warnings.length > 0 ? (
            <ul className="space-y-0.5 text-[10px] text-muted-foreground">
              {draft.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-warning" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {draft.executionRecordId != null && status === "approved" ? (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">
                Created record #{draft.executionRecordId}
              </p>
              {draft.executionRecordHref ? (
                <a
                  href={draft.executionRecordHref}
                  className="inline-flex text-[10px] font-medium text-primary hover:underline"
                >
                  Open created record
                </a>
              ) : null}
            </div>
          ) : null}

          {draft.executionError ? (
            <p className="text-[10px] text-destructive">{draft.executionError}</p>
          ) : null}

          {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
        </div>
      </div>

      {isPending ? (
        <div className="px-2.5 pb-2">
          <AiActionDraftDiffPanel
            draft={draft}
            reviewed={confirmedReview}
            onReviewedChange={setConfirmedReview}
          />
        </div>
      ) : null}

      <div className="border-t border-border/60 px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex flex-1 items-center justify-between text-[10px] text-muted-foreground hover:text-foreground"
          >
            <span>Parameters</span>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {isPending && onUpdateDraft ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] gap-1"
              disabled={busy != null}
              onClick={() => {
                setEditing((v) => !v)
                setEditError(null)
                setEditJson(paramsPreview)
              }}
            >
              <Pencil className="h-3 w-3" />
              {editing ? "Cancel edit" : "Edit"}
            </Button>
          ) : null}
        </div>
        {expanded ? (
          editing ? (
            <div className="mt-1 space-y-1.5">
              <textarea
                value={editJson}
                onChange={(event) => setEditJson(event.target.value)}
                className="min-h-32 w-full rounded bg-background/80 p-2 font-mono text-[10px] leading-relaxed border border-border"
                spellCheck={false}
              />
              {editError ? <p className="text-[10px] text-destructive">{editError}</p> : null}
              <Button
                type="button"
                size="sm"
                className="h-7 text-[10px]"
                disabled={busy != null}
                onClick={() => void handleSaveParams()}
              >
                {busy === "save" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save parameters"}
              </Button>
            </div>
          ) : (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-background/80 p-2 text-[10px] leading-relaxed">
              {paramsPreview}
            </pre>
          )
        ) : null}
      </div>

      {isPending && (onApprove || onReject) ? (
        <div className="flex items-center gap-2 border-t border-border/60 p-2">
          {onApprove ? (
            <Button
              size="sm"
              className="h-7 text-[10px] gap-1"
              data-testid="ai-action-draft-approve"
              disabled={busy != null || !canApprove}
              onClick={() => void handleApprove()}
            >
              {busy === "approve" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Approve
            </Button>
          ) : null}
          {onReject ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] gap-1"
              data-testid="ai-action-draft-reject"
              disabled={busy != null}
              onClick={() => void handleReject()}
            >
              {busy === "reject" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Reject
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
