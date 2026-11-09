"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { isAiActionDraftOutcomeUnknown } from "@lumiere/query-hooks/hooks/ai-action-draft-result"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Pencil, ShieldAlert, X } from "lucide-react"
import type { ChatActionDraftPayload } from "@/lib/ai-chat-types"
import { AiActionDraftDiffPanel } from "./ai-action-draft-diff-panel"

interface AiActionDraftCardProps {
  draft: ChatActionDraftPayload
  scopeKey?: string
  onApprove?: (draft: ChatActionDraftPayload) => Promise<void>
  onReject?: (draft: ChatActionDraftPayload, reason?: string) => Promise<void>
  onUpdateDraft?: (draft: ChatActionDraftPayload) => Promise<void>
  onRefresh?: (draft: ChatActionDraftPayload) => Promise<ChatActionDraftPayload>
}

const unresolvedAttempts = new Set<string>()
function attemptStorageKey(scope: string | undefined, draft: ChatActionDraftPayload): string | undefined {
  return scope ? `lumiere:ai-draft-attempt:v1:${JSON.stringify([scope, draft.companyId, draft.draftId])}` : undefined
}
function hasAttempt(key: string | undefined): boolean {
  if (!key) return false
  try { return unresolvedAttempts.has(key) || sessionStorage.getItem(key) === "pending" } catch { return true }
}
function rememberAttempt(key: string | undefined) {
  if (!key) return
  // Persist before dispatch so a reload cannot turn an unresolved attempt into a fresh action.
  sessionStorage.setItem(key, "pending")
  unresolvedAttempts.add(key)
}
function clearAttempt(key: string | undefined) {
  if (!key) return
  unresolvedAttempts.delete(key)
  try { sessionStorage.removeItem(key) } catch { /* Retaining a marker only keeps the action locked. */ }
}
function isTerminalDraft(draft: ChatActionDraftPayload): boolean {
  return ["approved", "rejected", "failed", "expired"].includes(draft.status ?? "")
}

function reducerLabel(name: string): string {
  return name.replace(/_/g, " ")
}

export function AiActionDraftCard({
  draft,
  scopeKey,
  onApprove,
  onReject,
  onUpdateDraft,
  onRefresh,
}: AiActionDraftCardProps) {
  const { t } = useTranslation()
  const parametersId = useId()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editJson, setEditJson] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmedElevated, setConfirmedElevated] = useState(false)
  const [confirmedReview, setConfirmedReview] = useState(false)
  const [busy, setBusy] = useState<"approve" | "reject" | "save" | "refresh" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const attemptKey = attemptStorageKey(scopeKey, draft)
  const currentAttempt = useRef(attemptKey)
  currentAttempt.current = attemptKey
  const inFlight = useRef(false)
  const [outcomeUnknown, setOutcomeUnknown] = useState(() => hasAttempt(attemptKey))
  const [readbackRequired, setReadbackRequired] = useState(Boolean(onRefresh))
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  // A restored chat card is presentation history; read the current row before review.
  useEffect(() => {
    let current = true
    const unresolved = hasAttempt(attemptKey)
    setOutcomeUnknown(unresolved)
    setError(null)
    setReadbackRequired(Boolean(refreshRef.current))
    inFlight.current = Boolean(refreshRef.current)
    if (refreshRef.current) {
      setBusy("refresh")
      void refreshRef.current(draft).then(observed => {
        if (isTerminalDraft(observed)) clearAttempt(attemptKey)
        if (!current) return
        setReadbackRequired(false)
        setOutcomeUnknown(unresolved && !isTerminalDraft(observed))
        if (unresolved && !isTerminalDraft(observed)) setError("The outcome is still unconfirmed. No action has been retried.")
      }).catch(() => {
        if (current) setError("The saved draft could not be checked. Check its outcome before continuing.")
      }).finally(() => { if (current) { inFlight.current = false; setBusy(null) } })
    }
    return () => { current = false }
  }, [draft.draftId, draft.companyId, attemptKey])

  const handleRefresh = async () => {
    if (!onRefresh || inFlight.current) return
    const key = attemptKey
    inFlight.current = true
    setBusy("refresh")
    setError(null)
    try {
      const observed = await onRefresh(draft)
      if (isTerminalDraft(observed)) clearAttempt(key)
      if (currentAttempt.current !== key) return
      if ((outcomeUnknown || hasAttempt(key)) && !isTerminalDraft(observed)) {
        setError("The outcome is still unconfirmed. No action has been retried.")
      } else {
        setOutcomeUnknown(false)
        setReadbackRequired(false)
      }
      setConfirmedReview(false)
      setConfirmedElevated(false)
    } catch {
      if (currentAttempt.current !== key) return
      setReadbackRequired(true)
      setError("The saved draft could not be checked. No action has been retried.")
    } finally { if (currentAttempt.current === key) { inFlight.current = false; setBusy(null) } }
  }

  const performMutation = async (kind: "approve" | "reject" | "save", action: () => Promise<void>) => {
    if (inFlight.current || outcomeUnknown || readbackRequired || hasAttempt(attemptKey)) return
    const key = attemptKey
    try { rememberAttempt(key) } catch {
      setError("The action could not retain its recovery identity. No request was sent.")
      return
    }
    inFlight.current = true
    setBusy(kind)
    setError(null)
    try {
      await action()
      clearAttempt(key)
      if (currentAttempt.current === key && kind === "save") setEditing(false)
    } catch (err) {
      const uncertain = isAiActionDraftOutcomeUnknown(err)
      if (!uncertain) clearAttempt(key)
      if (currentAttempt.current !== key) return
      setOutcomeUnknown(uncertain)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (currentAttempt.current === key) { inFlight.current = false; setBusy(null) }
    }
  }

  const status = draft.status ?? "pending"
  const isPending = status === "pending"
  const statusLabel = outcomeUnknown
    ? t("aiChat.draft.outcomeUnconfirmed", { defaultValue: "Outcome unconfirmed" })
    : readbackRequired
      ? t("aiChat.draft.checkRequired", { defaultValue: "Saved status needs checking" })
      : busy === "approve" || busy === "reject"
        ? t("aiChat.draft.submitting", { defaultValue: "Submitting decision…" })
        : busy === "save"
          ? t("aiChat.draft.saving", { defaultValue: "Saving parameters…" })
          : {
              pending: t("aiChat.draft.awaitingReview", { defaultValue: "Awaiting review" }),
              approved: t("aiChat.draft.approved", { defaultValue: "Approved" }),
              rejected: t("aiChat.draft.rejected", { defaultValue: "Rejected" }),
              failed: t("aiChat.draft.failed", { defaultValue: "Failed" }),
              expired: t("aiChat.draft.expired", { defaultValue: "Expired" }),
            }[status]
  const paramsPreview = JSON.stringify(draft.paramsJson, null, 2)

  useEffect(() => {
    setEditJson(paramsPreview)
    setEditError(null)
    setConfirmedReview(false)
    setConfirmedElevated(false)
  }, [draft.draftId, draft.companyId, draft.reducerName, draft.summary, draft.elevated, paramsPreview])

  const canApprove =
    isPending &&
    !outcomeUnknown &&
    !readbackRequired &&
    confirmedReview &&
    (!draft.elevated || confirmedElevated) &&
    (!editing || editJson === paramsPreview)

  const handleSaveParams = async () => {
    if (!onUpdateDraft || !isPending || outcomeUnknown || readbackRequired || busy != null) return
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

    await performMutation("save", () => onUpdateDraft({ ...draft, paramsJson: parsed }))
  }

  const handleApprove = async () => {
    if (!onApprove || !isPending || !canApprove) return
    await performMutation("approve", () => onApprove(draft))
  }

  const handleReject = async () => {
    if (!onReject || !isPending) return
    await performMutation("reject", () => onReject(draft, "Rejected from chat"))
  }

  return (
    <div
      data-testid={`ai-action-draft-card-${draft.draftId}`}
      className={cn(
        "min-w-0 rounded-lg border text-sm [overflow-wrap:anywhere]",
        draft.elevated ? "border-warning/40 bg-warning/5" : "border-border bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="max-w-full whitespace-normal capitalize">
              {reducerLabel(draft.reducerName)}
            </Badge>
            <Badge
              variant={
                outcomeUnknown || readbackRequired
                  ? "outline"
                  : status === "approved"
                  ? "default"
                  : status === "rejected"
                    ? "secondary"
                    : status === "failed"
                      ? "destructive"
                      : "outline"
              }
              className="max-w-full whitespace-normal"
              role="status"
            >
              {statusLabel}
            </Badge>
            {draft.confidence > 0 ? (
              <span className="text-xs text-muted-foreground">
                {Math.round(draft.confidence * 100)}% confidence
              </span>
            ) : null}
          </div>

          <p className="text-sm leading-5">{draft.summary}</p>

          {draft.sourceQuery ? (
            <p className="text-xs text-muted-foreground line-clamp-2">
              Request: {draft.sourceQuery}
            </p>
          ) : null}

          {draft.expiresAt && (draft.status ?? "pending") === "pending" ? (
            <p className="text-xs text-muted-foreground">
              Expires {new Date(draft.expiresAt).toLocaleString()}
            </p>
          ) : null}

          {draft.elevated ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-xs text-warning">
                <ShieldAlert className="h-3 w-3 shrink-0" />
                <span>Elevated action — review parameters carefully before approving.</span>
              </div>
              {isPending ? (
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
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
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {draft.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-warning" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {draft.executionRecordId != null && status === "approved" && !readbackRequired && !outcomeUnknown ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Created record #{draft.executionRecordId}
              </p>
              {draft.executionRecordHref ? (
                <a
                  href={draft.executionRecordHref}
                  className="inline-flex text-xs font-medium text-primary hover:underline"
                >
                  Open created record
                </a>
              ) : null}
            </div>
          ) : null}

          {draft.executionError ? (
            <p className="text-xs text-destructive">{draft.executionError}</p>
          ) : null}

          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          {onRefresh ? <Button type="button" size="sm" variant="outline" className="min-h-8 text-xs" disabled={busy != null} onClick={() => void handleRefresh()} data-testid="ai-action-draft-check-outcome">{busy === "refresh" ? "Checking saved draft…" : "Check outcome"}</Button> : null}
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
            aria-expanded={expanded}
            aria-controls={parametersId}
            className="flex min-h-9 flex-1 items-center justify-between rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>Parameters</span>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {isPending && onUpdateDraft ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs gap-1"
              disabled={busy != null || outcomeUnknown || readbackRequired}
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
        <div id={parametersId} hidden={!expanded}>
        {expanded ? (
          editing ? (
            <div className="mt-1 space-y-1.5">
              <Textarea variant="plain"
                value={editJson}
                onChange={(event) => setEditJson(event.target.value)}
                className="field-sizing-fixed min-h-32 rounded border-border bg-background/80 p-2 font-mono text-xs leading-relaxed shadow-none md:text-xs"
                spellCheck={false}
                aria-label={t("aiChat.draft.parameters", { defaultValue: "Draft parameters" })}
              />
              {editError ? <p className="text-xs text-destructive">{editError}</p> : null}
              <Button
                type="button"
                size="sm"
                className="min-h-8 text-xs"
                disabled={busy != null || outcomeUnknown || readbackRequired}
                onClick={() => void handleSaveParams()}
              >
                {busy === "save" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save parameters"}
              </Button>
            </div>
          ) : (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-background/80 p-2 text-xs leading-relaxed">
              {paramsPreview}
            </pre>
          )
        ) : null}
        </div>
      </div>

      {isPending && (onApprove || onReject) ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 p-2">
          {onApprove ? (
            <Button
              size="sm"
              className="min-h-8 text-xs gap-1"
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
              className="min-h-8 text-xs gap-1"
              data-testid="ai-action-draft-reject"
              disabled={busy != null || outcomeUnknown || readbackRequired}
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
