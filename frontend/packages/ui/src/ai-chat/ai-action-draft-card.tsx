"use client"

import { useEffect, useId, useRef, useState } from "react"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { useTranslation } from "@lumiere/i18n"
import {
  AiActionDraftOutcomeUnknown,
  isAiActionDraftOutcomeUnknown,
} from "@lumiere/query-hooks/hooks/ai-action-draft-result"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  ShieldAlert,
  X,
} from "lucide-react"
import type { ChatActionDraftPayload } from "@/lib/ai-chat-types"
import { AiActionDraftDiffPanel } from "./ai-action-draft-diff-panel"
import { AssistantActionCard } from "./assistant-action-card"

interface AiActionDraftCardProps {
  draft: ChatActionDraftPayload
  scopeKey?: string
  onApprove?: (
    draft: ChatActionDraftPayload,
  ) => Promise<ChatActionDraftPayload | void>
  onReject?: (
    draft: ChatActionDraftPayload,
    reason?: string,
  ) => Promise<ChatActionDraftPayload | void>
  onUpdateDraft?: (
    draft: ChatActionDraftPayload,
  ) => Promise<ChatActionDraftPayload | void>
  onRefresh?: (draft: ChatActionDraftPayload) => Promise<ChatActionDraftPayload>
}

const unresolvedAttempts = new Set<string>()
function attemptStorageKey(
  scope: string | undefined,
  draft: ChatActionDraftPayload,
): string | undefined {
  return scope
    ? `lumiere:ai-draft-attempt:v1:${JSON.stringify([scope, draft.companyId, draft.draftId])}`
    : undefined
}
function hasAttempt(key: string | undefined): boolean {
  if (!key) return false
  try {
    return (
      unresolvedAttempts.has(key) || sessionStorage.getItem(key) === "pending"
    )
  } catch {
    return true
  }
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
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* Retaining a marker only keeps the action locked. */
  }
}
function isTerminalDraft(draft: ChatActionDraftPayload): boolean {
  return ["approved", "rejected", "failed", "expired"].includes(
    draft.status ?? "",
  )
}

const draftIntents = {
  create_task: { key: "createTask", label: "Create task" },
  create_sale_order: { key: "createSalesOrder", label: "Create sales order" },
  create_purchase_order: {
    key: "createPurchaseOrder",
    label: "Create purchase order",
  },
  reverse_payment_transaction: {
    key: "reversePayment",
    label: "Reverse payment",
  },
} as const

export function AiActionDraftCard({
  draft: initialDraft,
  scopeKey,
  onApprove,
  onReject,
  onUpdateDraft,
  onRefresh,
}: AiActionDraftCardProps) {
  const { t, i18n } = useTranslation()
  const parametersId = useId()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editJson, setEditJson] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [confirmedElevated, setConfirmedElevated] = useState(false)
  const [confirmedReview, setConfirmedReview] = useState(false)
  const [busy, setBusy] = useState<
    "approve" | "reject" | "save" | "refresh" | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const draftKey = JSON.stringify([
    scopeKey,
    initialDraft.companyId,
    initialDraft.draftId,
  ])
  const [readback, setReadback] = useState<{
    key: string
    draft: ChatActionDraftPayload
  }>()
  const observedDraft = readback?.key === draftKey ? readback.draft : undefined
  const draft = observedDraft ?? initialDraft
  const attemptKey = attemptStorageKey(scopeKey, initialDraft)
  const currentDraftKey = useRef(draftKey)
  currentDraftKey.current = draftKey
  const inFlight = useRef(false)
  const [outcomeUnknown, setOutcomeUnknown] = useState(() =>
    hasAttempt(attemptKey),
  )
  const [readbackRequired, setReadbackRequired] = useState(Boolean(onRefresh))
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  const receiveReadback = (observed: ChatActionDraftPayload) => {
    if (
      observed.draftId !== initialDraft.draftId ||
      (initialDraft.companyId != null &&
        observed.companyId !== initialDraft.companyId)
    ) {
      throw new AiActionDraftOutcomeUnknown()
    }
    setReadback({ key: draftKey, draft: observed })
  }

  // A restored chat card is presentation history; read the current row before review.
  useEffect(() => {
    let current = true
    const unresolved = hasAttempt(attemptKey)
    setOutcomeUnknown(unresolved)
    setError(null)
    setReadback(undefined)
    setReadbackRequired(Boolean(refreshRef.current))
    inFlight.current = Boolean(refreshRef.current)
    if (refreshRef.current) {
      setBusy("refresh")
      void refreshRef
        .current(initialDraft)
        .then((observed) => {
          if (!current || currentDraftKey.current !== draftKey) return
          receiveReadback(observed)
          if (isTerminalDraft(observed)) clearAttempt(attemptKey)
          setReadbackRequired(false)
          setOutcomeUnknown(unresolved && !isTerminalDraft(observed))
          if (unresolved && !isTerminalDraft(observed))
            setError(
              "The outcome is still unconfirmed. No action has been retried.",
            )
        })
        .catch(() => {
          if (current)
            setError(
              "The saved draft could not be checked. Check its outcome before continuing.",
            )
        })
        .finally(() => {
          if (current) {
            inFlight.current = false
            setBusy(null)
          }
        })
    }
    return () => {
      current = false
    }
  }, [draftKey, attemptKey])

  const handleRefresh = async () => {
    if (!onRefresh || inFlight.current) return
    const key = attemptKey
    inFlight.current = true
    setBusy("refresh")
    setError(null)
    try {
      const observed = await onRefresh(draft)
      if (currentDraftKey.current !== draftKey) return
      receiveReadback(observed)
      if (isTerminalDraft(observed)) clearAttempt(key)
      if ((outcomeUnknown || hasAttempt(key)) && !isTerminalDraft(observed)) {
        setError(
          "The outcome is still unconfirmed. No action has been retried.",
        )
      } else {
        setOutcomeUnknown(false)
        setReadbackRequired(false)
      }
      setConfirmedReview(false)
      setConfirmedElevated(false)
    } catch {
      if (currentDraftKey.current !== draftKey) return
      setReadbackRequired(true)
      setError(
        "The saved draft could not be checked. No action has been retried.",
      )
    } finally {
      if (currentDraftKey.current === draftKey) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  const performMutation = async (
    kind: "approve" | "reject" | "save",
    action: () => Promise<ChatActionDraftPayload | void>,
  ) => {
    if (
      inFlight.current ||
      outcomeUnknown ||
      readbackRequired ||
      hasAttempt(attemptKey)
    )
      return
    const key = attemptKey
    try {
      rememberAttempt(key)
    } catch {
      setError(
        "The action could not retain its recovery identity. No request was sent.",
      )
      return
    }
    inFlight.current = true
    setBusy(kind)
    setError(null)
    try {
      const observed = await action()
      if (currentDraftKey.current !== draftKey) {
        clearAttempt(key)
        return
      }
      if (observed) receiveReadback(observed)
      clearAttempt(key)
      if (kind === "save") setEditing(false)
    } catch (err) {
      const uncertain = isAiActionDraftOutcomeUnknown(err)
      if (!uncertain) clearAttempt(key)
      if (currentDraftKey.current !== draftKey) return
      setOutcomeUnknown(uncertain)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (currentDraftKey.current === draftKey) {
        inFlight.current = false
        setBusy(null)
      }
    }
  }

  const status = draft.status ?? "pending"
  const isPending = status === "pending"
  const reducerName = draft.reducerName.trim()
  const intent = Object.hasOwn(draftIntents, reducerName)
    ? draftIntents[reducerName as keyof typeof draftIntents]
    : undefined
  const needsReadback = readbackRequired || (!!onRefresh && !observedDraft)
  const confirmed = !outcomeUnknown && !needsReadback && busy == null
  const rawRecordId = draft.executionRecordId
  const executionId =
    typeof rawRecordId === "string" && !/^[1-9]\d*$/.test(rawRecordId)
      ? undefined
      : parseStrictU64(rawRecordId)
  const savedEffect =
    confirmed &&
    !!intent &&
    status === "approved" &&
    !draft.executionError &&
    executionId != null &&
    executionId > 0n
  const statusLabel =
    busy === "refresh"
      ? t("aiChat.draft.checking", { defaultValue: "Checking saved draft…" })
      : outcomeUnknown
        ? t("aiChat.draft.outcomeUnconfirmed", {
            defaultValue: "Outcome unconfirmed",
          })
        : needsReadback
          ? t("aiChat.draft.checkRequired", {
              defaultValue: "Saved status needs checking",
            })
          : busy === "approve" || busy === "reject"
            ? t("aiChat.draft.submitting", {
                defaultValue: "Submitting decision…",
              })
            : busy === "save"
              ? t("aiChat.draft.saving", { defaultValue: "Saving parameters…" })
              : {
                  pending: t("aiChat.draft.awaitingReview", {
                    defaultValue: "Awaiting review",
                  }),
                  approved: savedEffect
                    ? t("aiChat.draft.applied", { defaultValue: "Applied" })
                    : t("aiChat.draft.approved", { defaultValue: "Approved" }),
                  rejected: t("aiChat.draft.rejected", {
                    defaultValue: "Rejected",
                  }),
                  failed: t("aiChat.draft.failed", { defaultValue: "Failed" }),
                  expired: t("aiChat.draft.expired", {
                    defaultValue: "Expired",
                  }),
                }[status]
  const statusTone = busy
    ? "working"
    : outcomeUnknown || needsReadback
      ? "warning"
      : status === "failed"
        ? "error"
        : savedEffect
          ? "success"
          : "neutral"
  const title = intent
    ? t(`aiChat.draft.intent.${intent.key}`, { defaultValue: intent.label })
    : t("aiChat.draft.title", { defaultValue: "ERP action draft" })
  const isReversal = reducerName === "reverse_payment_transaction"
  const paramsPreview = JSON.stringify(draft.paramsJson, null, 2)
  const dates = confirmed
    ? ([
        [t("aiChat.draft.proposedAt"), draft.proposedAt],
        [t("aiChat.draft.reviewedAt"), draft.reviewedAt],
        [t("aiChat.draft.appliedAt"), savedEffect ? draft.executedAt : null],
      ] as const)
    : []

  useEffect(() => {
    setEditJson(paramsPreview)
    setEditError(null)
    setConfirmedReview(false)
    setConfirmedElevated(false)
  }, [
    draft.draftId,
    draft.companyId,
    draft.reducerName,
    draft.summary,
    draft.elevated,
    paramsPreview,
  ])

  const canApprove =
    isPending &&
    !outcomeUnknown &&
    !needsReadback &&
    confirmedReview &&
    (!draft.elevated || confirmedElevated) &&
    (!editing || editJson === paramsPreview)

  const handleSaveParams = async () => {
    if (
      !onUpdateDraft ||
      !isPending ||
      outcomeUnknown ||
      needsReadback ||
      busy != null
    )
      return
    setEditError(null)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(editJson) as Record<string, unknown>
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("Parameters must be a JSON object")
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Invalid JSON")
      return
    }

    await performMutation("save", () =>
      onUpdateDraft({ ...draft, paramsJson: parsed }),
    )
  }

  const handleApprove = async () => {
    if (!onApprove || !isPending || !canApprove) return
    await performMutation("approve", () => onApprove(draft))
  }

  const handleReject = async () => {
    if (!onReject || !isPending) return
    await performMutation("reject", () => onReject(draft, "Rejected from chat"))
  }

  const checkOutcome = onRefresh && (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy != null}
      onClick={() => void handleRefresh()}
      data-testid="ai-action-draft-check-outcome"
    >
      {busy === "refresh"
        ? t("aiChat.draft.checking", { defaultValue: "Checking saved draft…" })
        : t("aiChat.draft.checkOutcome", { defaultValue: "Check outcome" })}
    </Button>
  )

  return (
    <AssistantActionCard
      testId={`ai-action-draft-card-${draft.draftId}`}
      className={cn(draft.elevated && "border-warning/40")}
      title={title}
      description={
        draft.summary && draft.summary !== title ? draft.summary : undefined
      }
      status={{ label: statusLabel, tone: statusTone }}
      busy={busy != null}
      primaryAction={
        savedEffect && draft.executionRecordHref ? (
          <a
            href={draft.executionRecordHref}
            className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline underline-offset-4"
          >
            {t("aiChat.draft.openCreated", {
              defaultValue: "Open created record",
            })}
          </a>
        ) : isPending && (onApprove || onReject || checkOutcome) ? (
          <>
            {onApprove ? (
              <Button
                size="sm"
                variant={
                  outcomeUnknown || needsReadback ? "outline" : "default"
                }
                data-testid="ai-action-draft-approve"
                disabled={busy != null || !canApprove}
                onClick={() => void handleApprove()}
              >
                {busy === "approve" ? (
                  <Loader2
                    aria-hidden="true"
                    className="motion-safe:animate-spin"
                  />
                ) : (
                  <Check aria-hidden="true" />
                )}
                {t("aiChat.draft.approve", { defaultValue: "Approve draft" })}
              </Button>
            ) : null}
            {onReject ? (
              <Button
                size="sm"
                variant="ghost"
                data-testid="ai-action-draft-reject"
                disabled={busy != null || outcomeUnknown || needsReadback}
                onClick={() => void handleReject()}
              >
                {busy === "reject" ? (
                  <Loader2
                    aria-hidden="true"
                    className="motion-safe:animate-spin"
                  />
                ) : (
                  <X aria-hidden="true" />
                )}
                {t("aiChat.draft.reject", { defaultValue: "Reject" })}
              </Button>
            ) : null}
            {checkOutcome}
          </>
        ) : (
          checkOutcome
        )
      }
    >
      {dates.some(([, date]) => date) ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          {dates.map(([label, date]) =>
            date ? (
              <div key={label} className="space-y-0.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>
                  <time dateTime={date}>
                    {new Date(date).toLocaleString(i18n.resolvedLanguage, {
                      timeZoneName: "short",
                    })}
                  </time>
                </dd>
              </div>
            ) : null,
          )}
        </dl>
      ) : null}

      {(draft.expiresAt && isPending) ||
      draft.elevated ||
      draft.warnings.length > 0 ||
      savedEffect ||
      draft.executionError ||
      error ? (
        <div className="space-y-2">
          {draft.expiresAt && (draft.status ?? "pending") === "pending" ? (
            <p className="text-xs text-muted-foreground">
              Expires {new Date(draft.expiresAt).toLocaleString()}
            </p>
          ) : null}

          {draft.elevated ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-xs text-warning">
                <ShieldAlert className="h-3 w-3 shrink-0" />
                <span>
                  Elevated action — review parameters carefully before
                  approving.
                </span>
              </div>
              {isPending ? (
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={confirmedElevated}
                    onCheckedChange={(checked) =>
                      setConfirmedElevated(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span>
                    I have reviewed the parameters and approve this elevated
                    action.
                  </span>
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

          {savedEffect ? (
            <p className="text-sm text-muted-foreground">
              {t(
                isReversal
                  ? "aiChat.draft.savedReversal"
                  : "aiChat.draft.createdRecord",
                {
                  defaultValue: isReversal
                    ? "Saved payment reversal #{{id}}"
                    : "Created record #{{id}}",
                  id: String(executionId),
                },
              )}
            </p>
          ) : null}

          {draft.executionError ? (
            <p className="text-xs text-destructive">{draft.executionError}</p>
          ) : null}

          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <AiActionDraftDiffPanel
        draft={draft}
        reviewed={confirmedReview}
        onReviewedChange={setConfirmedReview}
        nested
      />

      <div className="border-t border-border/60 pt-1">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={parametersId}
            className="flex min-h-9 flex-1 items-center justify-between rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>Parameters</span>
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          {isPending && onUpdateDraft ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs gap-1"
              disabled={busy != null || outcomeUnknown || needsReadback}
              onClick={() => {
                setExpanded(true)
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
                <Textarea
                  variant="plain"
                  value={editJson}
                  onChange={(event) => setEditJson(event.target.value)}
                  className="field-sizing-fixed min-h-32 rounded border-border bg-background/80 p-2 font-mono text-xs leading-relaxed shadow-none md:text-xs"
                  spellCheck={false}
                  aria-label={t("aiChat.draft.parameters", {
                    defaultValue: "Draft parameters",
                  })}
                />
                {editError ? (
                  <p className="text-xs text-destructive">{editError}</p>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="min-h-8 text-xs"
                  disabled={busy != null || outcomeUnknown || needsReadback}
                  onClick={() => void handleSaveParams()}
                >
                  {busy === "save" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Save parameters"
                  )}
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
    </AssistantActionCard>
  )
}
