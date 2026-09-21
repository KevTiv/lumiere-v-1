"use client"

import type { JsonObject } from "@lumiere/api-client/json-object"

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertCircle, BookOpenCheck, Building2, CheckCircle2, Download, MessageSquarePlus, Search, ShieldX } from "lucide-react"
import { Button } from "@lumiere/ui"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@lumiere/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@lumiere/ui/components/field"
import { Input } from "@lumiere/ui/components/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { Textarea } from "@lumiere/ui/components/textarea"

import { companyRowsToSelectOptions } from "@/lib/form-lookup"
import { mapEvidenceInspection, type EvidenceInspectionView, type EvidenceTargetKind } from "./evidence-inspection"
import { EvidenceReviewQueuePanel } from "./evidence-review-queue-panel"

interface EvidenceReviewerPanelProps {
  companies: JsonObject[]
}

type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "denied"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; data: EvidenceInspectionView }

type MutationState = { status: "idle" } | { status: "loading" } | { status: "success"; message: string } | { status: "error"; message: string }

const CHAT_SESSION_KEY = "lumiere:erp-ai-chat-session-key"

function parseIds(value: string): number[] | null {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean)
  const parsed = parts.map(Number)
  if (parts.length === 0 || parsed.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null
  return [...new Set(parsed)]
}

export function EvidenceReviewerPanel({ companies }: EvidenceReviewerPanelProps) {
  const searchParams = useSearchParams()
  const companyOptions = useMemo(() => companyRowsToSelectOptions(companies), [companies])
  const linkedRunId = Number(searchParams.get("runId"))
  const [companyId, setCompanyId] = useState(() => companyOptions[0]?.value ?? "")
  const [kind, setKind] = useState<EvidenceTargetKind>("decision")
  const [targetId, setTargetId] = useState("")
  const [nodeKey, setNodeKey] = useState("")
  const [request, setRequest] = useState<RequestState>({ status: "idle" })
  const [decisionTitle, setDecisionTitle] = useState("")
  const [adoptedClaims, setAdoptedClaims] = useState("")
  const [decisionRationale, setDecisionRationale] = useState("")
  const [reviewOutcome, setReviewOutcome] = useState("accepted")
  const [reviewNote, setReviewNote] = useState("")
  const [mutation, setMutation] = useState<MutationState>({ status: "idle" })
  const captureEventRef = useRef<string | null>(null)
  const isLoading = request.status === "loading"

  const changeTarget = (update: () => void) => {
    update()
    setRequest({ status: "idle" })
  }

  const loadInspection = async (
    override?: { kind: EvidenceTargetKind; id: number; nodeKey?: string },
  ) => {
    const parsedCompanyId = Number(companyId)
    const inspectKind = override?.kind ?? kind
    const parsedTargetId = override?.id ?? Number(targetId)
    const inspectNodeKey = (override ? override.nodeKey : nodeKey.trim()) ?? ""
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0
      || !Number.isSafeInteger(parsedTargetId) || parsedTargetId <= 0) {
      setRequest({ status: "error", message: "Choose a company and enter a positive record ID." })
      return
    }
    if (inspectKind === "workflow_step" && !inspectNodeKey) {
      setRequest({ status: "error", message: "Enter the workflow step's node key." })
      return
    }

    setRequest({ status: "loading" })
    try {
      const response = await fetch("/api/ai/evidence/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: parsedCompanyId,
          kind: inspectKind,
          id: parsedTargetId,
          ...(inspectKind === "workflow_step" ? { nodeKey: inspectNodeKey } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (response.status === 401 || response.status === 403) {
        setRequest({
          status: "denied",
          message: typeof payload.error === "string" ? payload.error : "Reviewer access is required.",
        })
        return
      }
      if (!response.ok) {
        setRequest({
          status: "error",
          message: response.status === 404
            ? "No evidence lineage was found for that record."
            : "The evidence inspection could not be loaded.",
        })
        return
      }
      const mapped = mapEvidenceInspection(payload)
      if (!mapped) {
        setRequest({ status: "error", message: "The inspection response was incomplete." })
        return
      }
      setRequest({ status: "success", data: mapped })
    } catch {
      setRequest({ status: "error", message: "The evidence inspection service is unavailable." })
    }
  }

  useEffect(() => {
    const runId = Number(searchParams.get("runId"))
    const requestedCompanyId = Number(searchParams.get("companyId"))
    if (!Number.isSafeInteger(runId) || runId <= 0) return
    const selectedCompanyId =
      Number.isSafeInteger(requestedCompanyId) && requestedCompanyId > 0
        ? requestedCompanyId
        : Number(companyId)
    if (!Number.isSafeInteger(selectedCompanyId) || selectedCompanyId <= 0) return

    if (String(selectedCompanyId) !== companyId) {
      setCompanyId(String(selectedCompanyId))
    }
    let cancelled = false
    void (async () => {
      setRequest({ status: "loading" })
      try {
        const response = await fetch("/api/ai/evidence/runs/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: selectedCompanyId, runId }),
        })
        const payload = await response.json().catch(() => ({})) as JsonObject
        if (cancelled) return
        if (!response.ok) {
          setRequest({
            status: response.status === 401 || response.status === 403 ? "denied" : "error",
            message:
              typeof payload.error === "string"
                ? payload.error
                : "The run evidence inspection could not be loaded.",
          })
          return
        }
        const claimIds = Array.isArray(payload.claimIds)
          ? payload.claimIds.filter(
              (value): value is number => Number.isSafeInteger(value) && Number(value) > 0,
            )
          : []
        const claimId = claimIds[0]
        if (!claimId) {
          setRequest({ status: "error", message: "This run has no persisted answer claims." })
          return
        }
        setKind("claim")
        setTargetId(String(claimId))
        await loadInspection({ kind: "claim", id: claimId })
      } catch {
        if (!cancelled) {
          setRequest({ status: "error", message: "The run evidence inspection is unavailable." })
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Run deep links are intentionally resolved once per URL/company selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const exportLinkedRun = async () => {
    const parsedCompanyId = Number(companyId)
    if (!Number.isSafeInteger(linkedRunId) || linkedRunId <= 0
      || !Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0) return
    const response = await fetch("/api/ai/evidence/runs/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: parsedCompanyId, runId: linkedRunId }),
    })
    if (!response.ok) {
      setRequest({ status: "error", message: "The authorized run export could not be created." })
      return
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `lumiere-run-${linkedRunId}-evidence.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const inspect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void loadInspection()
  }

  const captureDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedCompanyId = Number(companyId)
    const claimIds = parseIds(adoptedClaims)
    const sessionRef = window.localStorage.getItem(CHAT_SESSION_KEY)
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0 || !claimIds || !sessionRef
      || !decisionTitle.trim() || !decisionRationale.trim()) {
      setMutation({ status: "error", message: "Choose a company, start an assistant discussion, and provide a title, rationale, and adopted claim IDs." })
      return
    }
    setMutation({ status: "loading" })
    try {
      const eventRef = captureEventRef.current ?? crypto.randomUUID()
      captureEventRef.current = eventRef
      const response = await fetch("/api/ai/evidence/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: parsedCompanyId,
          sessionRef,
          turnRef: null,
          eventRef,
          title: decisionTitle.trim(),
          adoptedClaimIds: claimIds,
          rationale: decisionRationale.trim(),
          supersedesDecisionId: null,
        }),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The decision could not be captured.")
      const decisionId = Number(payload.decisionId)
      if (!Number.isSafeInteger(decisionId) || decisionId <= 0) throw new Error("The captured decision response was incomplete.")
      setKind("decision")
      setTargetId(String(decisionId))
      setDecisionTitle("")
      setAdoptedClaims("")
      setDecisionRationale("")
      captureEventRef.current = null
      setMutation({ status: "success", message: `Decision #${decisionId} was captured with its user contribution and is awaiting review.` })
    } catch (error) {
      setMutation({ status: "error", message: error instanceof Error ? error.message : "The decision could not be captured." })
    }
  }

  const review = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedCompanyId = Number(companyId)
    const parsedTargetId = Number(targetId)
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0 || !Number.isSafeInteger(parsedTargetId) || parsedTargetId <= 0) return
    setMutation({ status: "loading" })
    try {
      const response = await fetch("/api/ai/evidence/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: parsedCompanyId, kind, id: parsedTargetId, outcome: reviewOutcome, note: reviewNote.trim() || null }),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The review could not be recorded.")
      setReviewNote("")
      setMutation({ status: "success", message: `${kind === "decision" ? "Decision" : "Claim"} review recorded.` })
      await loadInspection()
    } catch (error) {
      setMutation({ status: "error", message: error instanceof Error ? error.message : "The review could not be recorded." })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BookOpenCheck />
          <h2 className="text-xl font-semibold tracking-tight">Evidence reviewer</h2>
          <Badge variant="outline">Reviewer only</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Inspect a decision or claim and trace it back to reviewed passages and attributed sources.
        </p>
        {Number.isSafeInteger(linkedRunId) && linkedRunId > 0 ? (
          <Button type="button" variant="outline" className="mt-2 w-fit" onClick={() => void exportLinkedRun()}>
            <Download data-icon="inline-start" /> Export run #{linkedRunId}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find evidence lineage</CardTitle>
          <CardDescription>Organization and reviewer identity come from your session.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={inspect}>
            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field>
                <FieldLabel>Company</FieldLabel>
                <Select
                  value={companyId}
                  onValueChange={(value) => changeTarget(() => {
                    captureEventRef.current = null
                    setCompanyId(value)
                  })}
                  disabled={companyOptions.length === 0 || isLoading}
                >
                  <SelectTrigger><Building2 /><SelectValue placeholder="Select a company…" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {companyOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Record type</FieldLabel>
                <Select
                  value={kind}
                  onValueChange={(value) => changeTarget(() => {
                    const nextKind = value as EvidenceTargetKind
                    setKind(nextKind)
                    setReviewOutcome(nextKind === "decision" ? "accepted" : "supported")
                  })}
                  disabled={isLoading}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="decision">Decision</SelectItem>
                      <SelectItem value="claim">Claim</SelectItem>
                      <SelectItem value="workflow_step">Workflow step</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="evidence-target-id">{kind === "workflow_step" ? "Workflow version ID" : "Record ID"}</FieldLabel>
                <Input
                  id="evidence-target-id"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={targetId}
                  disabled={isLoading}
                  onChange={(event) => changeTarget(() => setTargetId(event.target.value))}
                />
              </Field>
              {kind === "workflow_step" ? (
                <Field>
                  <FieldLabel htmlFor="evidence-node-key">Step node key</FieldLabel>
                  <Input
                    id="evidence-node-key"
                    maxLength={128}
                    value={nodeKey}
                    disabled={isLoading}
                    onChange={(event) => changeTarget(() => setNodeKey(event.target.value))}
                  />
                </Field>
              ) : null}
            </FieldGroup>
            <Button type="submit" disabled={isLoading || !companyId || !targetId || (kind === "workflow_step" && !nodeKey.trim())}>
              <Search data-icon="inline-start" /> Inspect lineage
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capture a discussion decision</CardTitle>
          <CardDescription>The active assistant discussion supplies the user-attributed contribution; the decision remains proposed until reviewed.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={captureDecision}>
            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field><FieldLabel htmlFor="decision-title">Title</FieldLabel><Input id="decision-title" maxLength={512} value={decisionTitle} onChange={(event) => { captureEventRef.current = null; setDecisionTitle(event.target.value) }} /></Field>
              <Field><FieldLabel htmlFor="adopted-claims">Adopted claim IDs</FieldLabel><Input id="adopted-claims" inputMode="numeric" placeholder="12, 18" value={adoptedClaims} onChange={(event) => { captureEventRef.current = null; setAdoptedClaims(event.target.value) }} /></Field>
            </FieldGroup>
            <Field><FieldLabel htmlFor="decision-rationale">Observable rationale</FieldLabel><Textarea id="decision-rationale" maxLength={2000} value={decisionRationale} onChange={(event) => { captureEventRef.current = null; setDecisionRationale(event.target.value) }} /></Field>
            <Button type="submit" disabled={mutation.status === "loading" || !companyId}><MessageSquarePlus data-icon="inline-start" /> Capture proposed decision</Button>
          </form>
        </CardContent>
      </Card>

      {mutation.status === "success" ? <Alert><CheckCircle2 /><AlertTitle>Saved</AlertTitle><AlertDescription>{mutation.message}</AlertDescription></Alert> : null}
      {mutation.status === "error" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Mutation rejected</AlertTitle><AlertDescription>{mutation.message}</AlertDescription></Alert> : null}

      <EvidenceReviewQueuePanel
        companyId={companyId}
        onInspect={(target) => {
          setKind(target.kind)
          setTargetId(String(target.id))
          if (target.nodeKey) setNodeKey(target.nodeKey)
          void loadInspection(target)
        }}
      />

      {request.status === "idle" ? <EmptyReviewerState /> : null}
      {request.status === "loading" ? <ReviewerSkeleton /> : null}
      {request.status === "denied" ? (
        <Alert variant="destructive"><ShieldX /><AlertTitle>Access denied</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert>
      ) : null}
      {request.status === "error" ? (
        <Alert variant="destructive"><AlertCircle /><AlertTitle>Inspection unavailable</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert>
      ) : null}
      {request.status === "success" ? <InspectionResult inspection={request.data} /> : null}
      {request.status === "success" && kind !== "workflow_step" ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Record reviewer verdict</CardTitle><CardDescription>The authenticated reviewer and timestamp are recorded by the evidence reducer.</CardDescription></CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={review}>
              <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field><FieldLabel>Outcome</FieldLabel><Select value={reviewOutcome} onValueChange={setReviewOutcome}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{kind === "decision" ? <><SelectItem value="accepted">Accepted</SelectItem><SelectItem value="rejected">Rejected</SelectItem></> : <><SelectItem value="supported">Supported</SelectItem><SelectItem value="qualified">Qualified</SelectItem><SelectItem value="unsupported">Unsupported</SelectItem></>}</SelectGroup></SelectContent></Select></Field>
                <Field><FieldLabel htmlFor="review-note">Review note</FieldLabel><Textarea id="review-note" maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></Field>
              </FieldGroup>
              <Button type="submit" disabled={mutation.status === "loading"}><BookOpenCheck data-icon="inline-start" /> Record review</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function EmptyReviewerState() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No evidence selected</EmptyTitle>
        <EmptyDescription>
          Select a company and enter a decision or claim ID to inspect its lineage.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ReviewerSkeleton() {
  return <div className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /><Skeleton className="h-40 w-full" /></div>
}

function InspectionResult({ inspection }: { inspection: EvidenceInspectionView }) {
  const hasLineage = inspection.decisions.length + inspection.claims.length + inspection.passages.length + inspection.sources.length > 0
  if (!hasLineage) {
    return <Alert><AlertCircle /><AlertTitle>No lineage records</AlertTitle><AlertDescription>The record exists, but no inspectable decision, claim, passage, or source links were returned.</AlertDescription></Alert>
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{inspection.targetKind} #{inspection.targetId}</CardTitle>
            <Badge variant={inspection.lineagePasses ? "default" : "destructive"}>{inspection.lineagePasses ? "Lineage passes" : "Review required"}</Badge>
          </div>
        </CardHeader>
        {inspection.findings.length > 0 ? <CardContent><ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{inspection.findings.map((finding, index) => <li key={`${finding.code}-${index}`}><span className="font-medium">{finding.code || finding.severity}:</span> {finding.message}</li>)}</ul></CardContent> : null}
      </Card>

      {inspection.revisions.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Step revisions</CardTitle><CardDescription>Newest first, following each edit or fork back to the original.</CardDescription></CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-1 text-sm">
              {inspection.revisions.map((revision) => (
                <li key={revision.id} data-testid={`inspection-revision-${revision.id}`}>
                  v{revision.version} · {revision.artifactRef} · {revision.componentKey} · {revision.linkState} · {revision.status}
                  {revision.parentComponentId ? ` · from #${revision.parentComponentId}` : " · original"}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {inspection.decisions.map((decision) => (
        <Card key={decision.id}><CardHeader><CardTitle className="text-base">Decision #{decision.id}: {decision.title || "Untitled decision"}</CardTitle><CardDescription>{decision.status}</CardDescription></CardHeader><CardContent className="text-sm leading-relaxed">{decision.rationale || "No rationale recorded."}</CardContent></Card>
      ))}

      {inspection.claims.map((claim) => (
        <Card key={claim.id}><CardHeader><CardTitle className="text-base">Claim #{claim.id}</CardTitle><CardDescription>{claim.kind} · {claim.verificationMethod} · {claim.verificationOutcome}{claim.reviewerUid ? ` · reviewed by ${claim.reviewerUid.slice(0, 8)}…` : ""}</CardDescription></CardHeader><CardContent className="text-sm leading-relaxed">{claim.statement}</CardContent></Card>
      ))}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {inspection.passages.map((passage) => (
          <Card key={passage.id}><CardHeader><CardTitle className="text-base">Passage #{passage.id}</CardTitle><CardDescription>{passage.availability}{passage.coordinates.length > 0 ? ` · ${passage.coordinates.join(", ")}` : ""}</CardDescription></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed">{passage.excerpt ?? "Excerpt unavailable for this reviewer."}{passage.excerptTruncated ? " …" : ""}</p></CardContent></Card>
        ))}
        {inspection.sources.map((source) => (
          <Card key={source.id}><CardHeader><CardTitle className="text-base">Source #{source.id}</CardTitle><CardDescription>{source.outOfScope ? "Out of scope" : source.scope ?? "Scope unknown"}</CardDescription></CardHeader><CardContent className="flex flex-col gap-1 text-sm">{source.outOfScope ? <p className="text-muted-foreground">Source metadata is hidden for this reviewer.</p> : <><p className="font-medium">{source.title ?? "Untitled source"}</p><p className="text-muted-foreground">{source.authors.length > 0 ? source.authors.join(", ") : source.authorAttribution === "unknown" ? "Author unknown" : "No author recorded"}</p></>}</CardContent></Card>
        ))}
      </div>
    </div>
  )
}
