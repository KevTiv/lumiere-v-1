"use client"

import { useCallback, useEffect, useState } from "react"
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

function stepLabel(step: { workflowVersionId: number | null; nodeKey: string | null }): string {
  return step.workflowVersionId && step.nodeKey
    ? `workflow ${step.workflowVersionId} · step ${step.nodeKey}`
    : "workflow step"
}

function AffectedSteps({ steps }: { steps: AffectedComponentView[] }) {
  if (steps.length === 0) return null
  return (
    <p className="text-xs text-muted-foreground">
      Affects: {steps.map((step) => `${stepLabel(step)} (${step.linkState})`).join("; ")}
    </p>
  )
}

export function EvidenceReviewQueuePanel({ companyId, onInspect }: EvidenceReviewQueuePanelProps) {
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
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (response.status === 401 || response.status === 403) {
        setState({
          status: "denied",
          message: typeof payload.error === "string" ? payload.error : "Reviewer access is required.",
        })
        return
      }
      const queue = response.ok ? mapReviewQueue(payload) : null
      if (!queue) {
        setState({ status: "error", message: "The review queue could not be loaded." })
        return
      }
      setState({ status: "ready", queue })
    } catch {
      setState({ status: "error", message: "The review queue is unavailable." })
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (target: QueueReviewTarget) => {
    const body = buildReviewRequest(Number(companyId), target, note)
    if (!body) {
      setVerdict({
        status: "error",
        message: target.kind === "claim" && target.outcome === "qualified"
          ? "A qualified verdict must say how it is qualified. Add a note."
          : "That verdict could not be recorded.",
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
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "The review could not be recorded.")
      }
      setNote("")
      setVerdict({ status: "saved", message: `${target.kind} #${target.id}: ${target.outcome}.` })
      await load()
    } catch (error) {
      setVerdict({ status: "error", message: error instanceof Error ? error.message : "The review could not be recorded." })
    }
  }

  const saving = verdict.status === "saving"

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck />
            <CardTitle className="text-base">Review queue</CardTitle>
            <Badge variant="outline">This company</Badge>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={state.status === "loading"}>
            <RefreshCw data-icon="inline-start" /> Refresh
          </Button>
        </div>
        <CardDescription>
          Claims and decisions awaiting a person, and workflow steps whose links need confirming. You cannot review what you created or proposed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.status === "loading" ? <Skeleton className="h-24 w-full" /> : null}
        {state.status === "denied" ? (
          <Alert variant="destructive"><ShieldX /><AlertTitle>Access denied</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert variant="destructive"><AlertCircle /><AlertTitle>Queue unavailable</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>
        ) : null}
        {verdict.status === "saved" ? <Alert><CheckCircle2 /><AlertTitle>Recorded</AlertTitle><AlertDescription>{verdict.message}</AlertDescription></Alert> : null}
        {verdict.status === "error" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Review rejected</AlertTitle><AlertDescription>{verdict.message}</AlertDescription></Alert> : null}

        {state.status === "ready" ? (
          <>
            <Field>
              <FieldLabel htmlFor="queue-review-note">Note for the next verdict</FieldLabel>
              <Textarea id="queue-review-note" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>

            <section aria-label="Claims awaiting review" className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Claims ({state.queue.claims.length}{state.queue.claimsTruncated ? "+" : ""})</h3>
              {state.queue.claims.length === 0 ? <p className="text-sm text-muted-foreground">No claims are waiting for review.</p> : null}
              {state.queue.claims.map((claim) => (
                <div key={claim.id} data-testid={`queue-claim-${claim.id}`} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Claim #{claim.id}</span>
                    <Badge variant={claim.queueReason === "needs_review" ? "destructive" : "secondary"}>
                      {claim.queueReason === "needs_review" ? "Needs review" : "Awaiting a person"}
                    </Badge>
                    <Badge variant="outline">{claim.verificationMethod} · {claim.verificationOutcome}</Badge>
                  </div>
                  <p className="text-sm leading-relaxed">{claim.statement}</p>
                  <p className="text-xs text-muted-foreground">
                    Sources: {claim.passages.length === 0 ? "none" : claim.passages.map((passage) => `#${passage.id} ${passage.availability}${passage.sourceTitle ? ` (${passage.sourceTitle})` : ""}`).join("; ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created by {shortIdentity(claim.creatorUid)}{claim.proposerUid ? ` · proposed by ${claim.proposerKind ?? "contributor"} ${shortIdentity(claim.proposerUid)}` : ""}
                  </p>
                  <AffectedSteps steps={claim.affectedComponents} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onInspect({ kind: "claim", id: claim.id })}>Inspect</Button>
                    {claim.reviewableByViewer ? (
                      <>
                        <Button type="button" size="sm" disabled={saving} onClick={() => void submit({ kind: "claim", id: claim.id, outcome: "supported" })}>Supported</Button>
                        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void submit({ kind: "claim", id: claim.id, outcome: "qualified" })}>Qualified</Button>
                        <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void submit({ kind: "claim", id: claim.id, outcome: "unsupported" })}>Unsupported</Button>
                      </>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">You created or proposed this, so another reviewer must decide.</span>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section aria-label="Decisions awaiting review" className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Decisions ({state.queue.decisions.length}{state.queue.decisionsTruncated ? "+" : ""})</h3>
              {state.queue.decisions.length === 0 ? <p className="text-sm text-muted-foreground">No decisions are waiting for review.</p> : null}
              {state.queue.decisions.map((decision) => (
                <div key={decision.id} data-testid={`queue-decision-${decision.id}`} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Decision #{decision.id}: {decision.title || "Untitled decision"}</span>
                    <Badge variant={decision.status === "needs_review" ? "destructive" : "secondary"}>{decision.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Adopts claim{decision.adoptedClaimIds.length === 1 ? "" : "s"} {decision.adoptedClaimIds.join(", ") || "none"} · created by {shortIdentity(decision.creatorUid)}
                  </p>
                  <AffectedSteps steps={decision.affectedComponents} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onInspect({ kind: "decision", id: decision.id })}>Inspect</Button>
                    {decision.reviewableByViewer ? (
                      <>
                        <Button type="button" size="sm" disabled={saving} onClick={() => void submit({ kind: "decision", id: decision.id, outcome: "accepted" })}>Accept</Button>
                        <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void submit({ kind: "decision", id: decision.id, outcome: "rejected" })}>Reject</Button>
                      </>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">You created or proposed this, so another reviewer must decide.</span>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section aria-label="Workflow steps needing link review" className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Workflow steps ({state.queue.components.length}{state.queue.componentsTruncated ? "+" : ""})</h3>
              {state.queue.components.length === 0 ? <p className="text-sm text-muted-foreground">No workflow step needs its links confirmed.</p> : null}
              {state.queue.components.map((component) => (
                <div key={component.id} data-testid={`queue-component-${component.id}`} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{stepLabel(component)}</span>
                    <Badge variant="destructive">{component.linkState}</Badge>
                    <Badge variant="outline">v{component.version}</Badge>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">Content {component.contentHash}</p>
                  <div className="flex flex-wrap gap-2">
                    {component.workflowVersionId && component.nodeKey ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onInspect({ kind: "workflow_step", id: component.workflowVersionId ?? 0, nodeKey: component.nodeKey ?? undefined })}
                      >
                        Inspect
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" disabled={saving} onClick={() => void submit({ kind: "component", id: component.id, outcome: "confirmed", expectedContentHash: component.contentHash })}>Confirm this content</Button>
                    <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => void submit({ kind: "component", id: component.id, outcome: "unresolved" })}>Leave unresolved</Button>
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
