"use client"

import type { JsonObject } from "@lumiere/api-client/json-object"

import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { AlertCircle, CheckCircle2, ClipboardCheck, RefreshCw, ShieldX } from "lucide-react"
import { Button } from "@lumiere/ui"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Field, FieldLabel } from "@lumiere/ui/components/field"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { Textarea } from "@lumiere/ui/components/textarea"

import {
  buildReviewRequest,
  mapReviewQueue,
  shortIdentity,
  type AffectedComponentView,
  type QueueReviewTarget,
  type ReviewQueueView,
} from "./evidence-review-queue"
import {
  availabilityLabel,
  evidenceMethodLabel,
  evidenceOutcomeLabel,
  evidenceStatusLabel,
  linkStateLabel,
  proposerKindLabel,
  reviewOutcomeLabel,
  reviewTargetLabel,
} from "./enum-labels"

interface EvidenceReviewQueuePanelProps {
  companyId: string
  /** Load the full lineage of an item in the inspector above. */
  onInspect: (target: { kind: "claim" | "decision" | "workflow_step"; id: number; nodeKey?: string }) => void
}

type QueueState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "denied"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; queue: ReviewQueueView }

type VerdictState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string }

function stepLabel(step: { workflowVersionId: number | null; nodeKey: string | null }, t: ReturnType<typeof useTranslation>["t"]): string {
  return step.workflowVersionId && step.nodeKey
    ? t("aiHarness.reviewQueue.workflowStepLabel", { workflowId: step.workflowVersionId, nodeKey: step.nodeKey })
    : t("aiHarness.reviewQueue.workflowStep")
}

function AffectedSteps({ steps }: { steps: AffectedComponentView[] }) {
  const { t } = useTranslation()
  if (steps.length === 0) return null
  return (
    <p className="text-xs text-muted-foreground">
      {t("aiHarness.reviewQueue.affects", { steps: steps.map((step) => `${stepLabel(step, t)} (${linkStateLabel(t, step.linkState)})`).join("; ") })}
    </p>
  )
}

export function EvidenceReviewQueuePanel({ companyId, onInspect }: EvidenceReviewQueuePanelProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<QueueState>({ status: "idle" })
  const [verdict, setVerdict] = useState<VerdictState>({ status: "idle" })
  const [note, setNote] = useState("")

  const load = useCallback(async () => {
    const parsedCompanyId = Number(companyId)
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0) {
      setState({ status: "idle" })
      return
    }
    setState({ status: "loading" })
    try {
      const response = await fetch("/api/ai/evidence/review-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: parsedCompanyId }),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (response.status === 401 || response.status === 403) {
        setState({
          status: "denied",
          message: typeof payload.error === "string" ? payload.error : t("aiHarness.reviewQueue.errors.reviewerRequired"),
        })
        return
      }
      const queue = response.ok ? mapReviewQueue(payload) : null
      if (!queue) {
        setState({ status: "error", message: t("aiHarness.reviewQueue.errors.loadFailed") })
        return
      }
      setState({ status: "ready", queue })
    } catch {
      setState({ status: "error", message: t("aiHarness.reviewQueue.errors.unavailable") })
    }
  }, [companyId, t])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (target: QueueReviewTarget) => {
    const body = buildReviewRequest(Number(companyId), target, note)
    if (!body) {
      setVerdict({
        status: "error",
        message: target.kind === "claim" && target.outcome === "qualified"
          ? t("aiHarness.reviewQueue.errors.qualifiedNoteRequired")
          : t("aiHarness.reviewQueue.errors.verdictFailed"),
      })
      return
    }
    setVerdict({ status: "saving" })
    try {
      const response = await fetch("/api/ai/evidence/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : t("aiHarness.reviewQueue.errors.reviewFailed"))
      }
      setNote("")
      setVerdict({ status: "saved", message: t("aiHarness.reviewQueue.verdictRecorded", { kind: reviewTargetLabel(t, target.kind), id: target.id, outcome: reviewOutcomeLabel(t, target.outcome) }) })
      await load()
    } catch (error) {
      setVerdict({ status: "error", message: error instanceof Error ? error.message : t("aiHarness.reviewQueue.errors.reviewFailed") })
    }
  }

  const saving = verdict.status === "saving"

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck />
            <CardTitle className="text-base">{t("aiHarness.reviewQueue.title")}</CardTitle>
            <Badge variant="outline">{t("aiHarness.reviewQueue.thisCompany")}</Badge>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={state.status === "loading"}>
            <RefreshCw data-icon="inline-start" /> {t("aiHarness.reviewQueue.refresh")}
          </Button>
        </div>
        <CardDescription>
          {t("aiHarness.reviewQueue.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status === "loading" ? <Skeleton className="h-24 w-full" /> : null}
        {state.status === "denied" ? (
          <Alert variant="destructive"><ShieldX /><AlertTitle>{t("aiHarness.reviewQueue.accessDenied")}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("aiHarness.reviewQueue.queueUnavailable")}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>
        ) : null}
        {verdict.status === "saved" ? <Alert><CheckCircle2 /><AlertTitle>{t("aiHarness.reviewQueue.recorded")}</AlertTitle><AlertDescription>{verdict.message}</AlertDescription></Alert> : null}
        {verdict.status === "error" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("aiHarness.reviewQueue.reviewRejected")}</AlertTitle><AlertDescription>{verdict.message}</AlertDescription></Alert> : null}

        {state.status === "ready" ? (
          <>
            <Field>
              <FieldLabel htmlFor="queue-review-note">{t("aiHarness.reviewQueue.noteLabel")}</FieldLabel>
              <Textarea id="queue-review-note" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>

            <section aria-label={t("aiHarness.reviewQueue.claimsAriaLabel")} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">{t("aiHarness.reviewQueue.claimsCount", { count: state.queue.claims.length, suffix: state.queue.claimsTruncated ? "+" : "" })}</h3>
              {state.queue.claims.length === 0 ? <p className="text-sm text-muted-foreground">{t("aiHarness.reviewQueue.noClaims")}</p> : null}
              {state.queue.claims.map((claim) => (
                <div key={claim.id} data-testid={`queue-claim-${claim.id}`} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{t("aiHarness.reviewQueue.claimNumber", { id: claim.id })}</span>
                    <Badge variant={claim.queueReason === "needs_review" ? "destructive" : "secondary"}>
                      {claim.queueReason === "needs_review" ? t("aiHarness.reviewQueue.needsReview") : t("aiHarness.reviewQueue.awaitingPerson")}
                    </Badge>
                    <Badge variant="outline">{evidenceMethodLabel(t, claim.verificationMethod)} · {evidenceOutcomeLabel(t, claim.verificationOutcome)}</Badge>
                  </div>
                  <p className="text-sm leading-relaxed">{claim.statement}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("aiHarness.reviewQueue.sources", { sources: claim.passages.length === 0 ? t("aiHarness.reviewQueue.none") : claim.passages.map((passage) => `#${passage.id} ${availabilityLabel(t, passage.availability)}${passage.sourceTitle ? ` (${passage.sourceTitle})` : ""}`).join("; ") })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("aiHarness.reviewQueue.createdBy", { creator: shortIdentity(claim.creatorUid), proposal: claim.proposerUid ? t("aiHarness.reviewQueue.proposedBy", { kind: proposerKindLabel(t, claim.proposerKind ?? "contributor"), proposer: shortIdentity(claim.proposerUid) }) : "" })}
                  </p>
                  <AffectedSteps steps={claim.affectedComponents} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onInspect({ kind: "claim", id: claim.id })}>{t("aiHarness.reviewQueue.inspect")}</Button>
                    {claim.reviewableByViewer ? (
                      <>
                        <Button type="button" size="sm" disabled={saving} onClick={() => void submit({ kind: "claim", id: claim.id, outcome: "supported" })}>{t("aiHarness.reviewQueue.supported")}</Button>
                        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void submit({ kind: "claim", id: claim.id, outcome: "qualified" })}>{t("aiHarness.reviewQueue.qualified")}</Button>
                        <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void submit({ kind: "claim", id: claim.id, outcome: "unsupported" })}>{t("aiHarness.reviewQueue.unsupported")}</Button>
                      </>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">{t("aiHarness.reviewQueue.otherReviewerRequired")}</span>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section aria-label={t("aiHarness.reviewQueue.decisionsAriaLabel")} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">{t("aiHarness.reviewQueue.decisionsCount", { count: state.queue.decisions.length, suffix: state.queue.decisionsTruncated ? "+" : "" })}</h3>
              {state.queue.decisions.length === 0 ? <p className="text-sm text-muted-foreground">{t("aiHarness.reviewQueue.noDecisions")}</p> : null}
              {state.queue.decisions.map((decision) => (
                <div key={decision.id} data-testid={`queue-decision-${decision.id}`} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{t("aiHarness.reviewQueue.decisionTitle", { id: decision.id, title: decision.title || t("aiHarness.reviewQueue.untitledDecision") })}</span>
                    <Badge variant={decision.status === "needs_review" ? "destructive" : "secondary"}>{evidenceStatusLabel(t, decision.status)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("aiHarness.reviewQueue.adoptedClaims", { count: decision.adoptedClaimIds.length, claims: decision.adoptedClaimIds.join(", ") || t("aiHarness.reviewQueue.none"), creator: shortIdentity(decision.creatorUid) })}
                  </p>
                  <AffectedSteps steps={decision.affectedComponents} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onInspect({ kind: "decision", id: decision.id })}>{t("aiHarness.reviewQueue.inspect")}</Button>
                    {decision.reviewableByViewer ? (
                      <>
                        <Button type="button" size="sm" disabled={saving} onClick={() => void submit({ kind: "decision", id: decision.id, outcome: "accepted" })}>{t("aiHarness.reviewQueue.accept")}</Button>
                        <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void submit({ kind: "decision", id: decision.id, outcome: "rejected" })}>{t("aiHarness.reviewQueue.reject")}</Button>
                      </>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">{t("aiHarness.reviewQueue.otherReviewerRequired")}</span>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section aria-label={t("aiHarness.reviewQueue.workflowStepsAriaLabel")} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">{t("aiHarness.reviewQueue.workflowStepsCount", { count: state.queue.components.length, suffix: state.queue.componentsTruncated ? "+" : "" })}</h3>
              {state.queue.components.length === 0 ? <p className="text-sm text-muted-foreground">{t("aiHarness.reviewQueue.noWorkflowSteps")}</p> : null}
              {state.queue.components.map((component) => (
                <div key={component.id} data-testid={`queue-component-${component.id}`} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{stepLabel(component, t)}</span>
                    <Badge variant="destructive">{linkStateLabel(t, component.linkState)}</Badge>
                    <Badge variant="outline">v{component.version}</Badge>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">{t("aiHarness.reviewQueue.contentHash", { hash: component.contentHash })}</p>
                  <div className="flex flex-wrap gap-2">
                    {component.workflowVersionId && component.nodeKey ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onInspect({ kind: "workflow_step", id: component.workflowVersionId ?? 0, nodeKey: component.nodeKey ?? undefined })}
                      >
                        {t("aiHarness.reviewQueue.inspect")}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" disabled={saving} onClick={() => void submit({ kind: "component", id: component.id, outcome: "confirmed", expectedContentHash: component.contentHash })}>{t("aiHarness.reviewQueue.confirmContent")}</Button>
                    <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void submit({ kind: "component", id: component.id, outcome: "unresolved" })}>{t("aiHarness.reviewQueue.leaveUnresolved")}</Button>
                  </div>
                </div>
              ))}
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
