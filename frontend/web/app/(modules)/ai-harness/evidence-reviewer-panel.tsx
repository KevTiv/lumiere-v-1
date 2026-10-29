"use client"

import type { JsonObject } from "@lumiere/api-client/json-object"

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
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
import { availabilityLabel, claimKindLabel, evidenceMethodLabel, evidenceOutcomeLabel, evidenceStatusLabel, linkStateLabel, reviewTargetLabel } from "./enum-labels"

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
  const { t } = useTranslation()
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
    override?: { kind: EvidenceTargetKind; id: number; nodeKey?: string; companyId?: number },
  ) => {
    const parsedCompanyId = override?.companyId ?? Number(companyId)
    const inspectKind = override?.kind ?? kind
    const parsedTargetId = override?.id ?? Number(targetId)
    const inspectNodeKey = (override ? override.nodeKey : nodeKey.trim()) ?? ""
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0
      || !Number.isSafeInteger(parsedTargetId) || parsedTargetId <= 0) {
      setRequest({ status: "error", message: t("aiHarness.evidenceReviewer.errors.chooseCompanyAndRecord") })
      return
    }
    if (inspectKind === "workflow_step" && !inspectNodeKey) {
      setRequest({ status: "error", message: t("aiHarness.evidenceReviewer.errors.nodeKeyRequired") })
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
          message: typeof payload.error === "string" ? payload.error : t("aiHarness.evidenceReviewer.errors.reviewerRequired"),
        })
        return
      }
      if (!response.ok) {
        setRequest({
          status: "error",
          message: response.status === 404
            ? t("aiHarness.evidenceReviewer.errors.lineageNotFound")
            : t("aiHarness.evidenceReviewer.errors.inspectionLoadFailed"),
        })
        return
      }
      const mapped = mapEvidenceInspection(payload)
      if (!mapped) {
        setRequest({ status: "error", message: t("aiHarness.evidenceReviewer.errors.inspectionIncomplete") })
        return
      }
      setRequest({ status: "success", data: mapped })
    } catch {
      setRequest({ status: "error", message: t("aiHarness.evidenceReviewer.errors.inspectionUnavailable") })
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
                : t("aiHarness.evidenceReviewer.errors.runInspectionLoadFailed"),
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
          setRequest({ status: "error", message: t("aiHarness.evidenceReviewer.errors.noPersistedClaims") })
          return
        }
        setKind("claim")
        setTargetId(String(claimId))
        await loadInspection({ kind: "claim", id: claimId, companyId: selectedCompanyId })
      } catch {
        if (!cancelled) {
          setRequest({ status: "error", message: t("aiHarness.evidenceReviewer.errors.runInspectionUnavailable") })
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
      setRequest({ status: "error", message: t("aiHarness.evidenceReviewer.errors.exportFailed") })
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
      setMutation({ status: "error", message: t("aiHarness.evidenceReviewer.errors.decisionFieldsRequired") })
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
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : t("aiHarness.evidenceReviewer.errors.decisionCaptureFailed"))
      const decisionId = Number(payload.decisionId)
      if (!Number.isSafeInteger(decisionId) || decisionId <= 0) throw new Error(t("aiHarness.evidenceReviewer.errors.decisionResponseIncomplete"))
      setKind("decision")
      setTargetId(String(decisionId))
      setDecisionTitle("")
      setAdoptedClaims("")
      setDecisionRationale("")
      captureEventRef.current = null
      setMutation({ status: "success", message: t("aiHarness.evidenceReviewer.decisionCaptured", { id: decisionId }) })
    } catch (error) {
      setMutation({ status: "error", message: error instanceof Error ? error.message : t("aiHarness.evidenceReviewer.errors.decisionCaptureFailed") })
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
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : t("aiHarness.evidenceReviewer.errors.reviewFailed"))
      setReviewNote("")
      setMutation({ status: "success", message: t("aiHarness.evidenceReviewer.reviewRecorded", { kind: kind === "decision" ? t("aiHarness.evidenceReviewer.decision") : t("aiHarness.evidenceReviewer.claim") }) })
      await loadInspection()
    } catch (error) {
      setMutation({ status: "error", message: error instanceof Error ? error.message : t("aiHarness.evidenceReviewer.errors.reviewFailed") })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BookOpenCheck />
          <h2 className="text-xl font-semibold tracking-tight">{t("aiHarness.evidenceReviewer.title")}</h2>
          <Badge variant="outline">{t("aiHarness.evidenceReviewer.reviewerOnly")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("aiHarness.evidenceReviewer.description")}
        </p>
        {Number.isSafeInteger(linkedRunId) && linkedRunId > 0 ? (
          <Button type="button" variant="outline" className="mt-2 w-fit" onClick={() => void exportLinkedRun()}>
            <Download data-icon="inline-start" /> {t("aiHarness.evidenceReviewer.exportRun", { id: linkedRunId })}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("aiHarness.evidenceReviewer.findLineage")}</CardTitle>
          <CardDescription>{t("aiHarness.evidenceReviewer.sessionIdentity")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={inspect}>
            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field>
                <FieldLabel>{t("aiHarness.evidenceReviewer.company")}</FieldLabel>
                <Select
                  value={companyId}
                  onValueChange={(value) => changeTarget(() => {
                    captureEventRef.current = null
                    setCompanyId(value)
                  })}
                  disabled={companyOptions.length === 0 || isLoading}
                >
                  <SelectTrigger><Building2 /><SelectValue placeholder={t("aiHarness.evidenceReviewer.companyPlaceholder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {companyOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>{t("aiHarness.evidenceReviewer.recordType")}</FieldLabel>
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
                      <SelectItem value="decision">{t("aiHarness.evidenceReviewer.decision")}</SelectItem>
                      <SelectItem value="claim">{t("aiHarness.evidenceReviewer.claim")}</SelectItem>
                      <SelectItem value="workflow_step">{t("aiHarness.evidenceReviewer.workflowStep")}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="evidence-target-id">{kind === "workflow_step" ? t("aiHarness.evidenceReviewer.workflowVersionId") : t("aiHarness.evidenceReviewer.recordId")}</FieldLabel>
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
                  <FieldLabel htmlFor="evidence-node-key">{t("aiHarness.evidenceReviewer.stepNodeKey")}</FieldLabel>
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
              <Search data-icon="inline-start" /> {t("aiHarness.evidenceReviewer.inspectLineage")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("aiHarness.evidenceReviewer.captureDecisionTitle")}</CardTitle>
          <CardDescription>{t("aiHarness.evidenceReviewer.captureDecisionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={captureDecision}>
            <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field><FieldLabel htmlFor="decision-title">{t("aiHarness.evidenceReviewer.decisionTitle")}</FieldLabel><Input id="decision-title" maxLength={512} value={decisionTitle} onChange={(event) => { captureEventRef.current = null; setDecisionTitle(event.target.value) }} /></Field>
              <Field><FieldLabel htmlFor="adopted-claims">{t("aiHarness.evidenceReviewer.adoptedClaimIds")}</FieldLabel><Input id="adopted-claims" inputMode="numeric" placeholder={t("aiHarness.evidenceReviewer.adoptedClaimIdsPlaceholder")} value={adoptedClaims} onChange={(event) => { captureEventRef.current = null; setAdoptedClaims(event.target.value) }} /></Field>
            </FieldGroup>
            <Field><FieldLabel htmlFor="decision-rationale">{t("aiHarness.evidenceReviewer.observableRationale")}</FieldLabel><Textarea id="decision-rationale" maxLength={2000} value={decisionRationale} onChange={(event) => { captureEventRef.current = null; setDecisionRationale(event.target.value) }} /></Field>
            <Button type="submit" disabled={mutation.status === "loading" || !companyId}><MessageSquarePlus data-icon="inline-start" /> {t("aiHarness.evidenceReviewer.captureProposedDecision")}</Button>
          </form>
        </CardContent>
      </Card>

      {mutation.status === "success" ? <Alert><CheckCircle2 /><AlertTitle>{t("aiHarness.evidenceReviewer.saved")}</AlertTitle><AlertDescription>{mutation.message}</AlertDescription></Alert> : null}
      {mutation.status === "error" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("aiHarness.evidenceReviewer.mutationRejected")}</AlertTitle><AlertDescription>{mutation.message}</AlertDescription></Alert> : null}

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
        <Alert variant="destructive"><ShieldX /><AlertTitle>{t("aiHarness.evidenceReviewer.accessDenied")}</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert>
      ) : null}
      {request.status === "error" ? (
        <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("aiHarness.evidenceReviewer.inspectionUnavailable")}</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert>
      ) : null}
      {request.status === "success" ? <InspectionResult inspection={request.data} /> : null}
      {request.status === "success" && kind !== "workflow_step" ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("aiHarness.evidenceReviewer.recordVerdict")}</CardTitle><CardDescription>{t("aiHarness.evidenceReviewer.recordVerdictDescription")}</CardDescription></CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={review}>
              <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field><FieldLabel>{t("aiHarness.evidenceReviewer.outcome")}</FieldLabel><Select value={reviewOutcome} onValueChange={setReviewOutcome}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{kind === "decision" ? <><SelectItem value="accepted">{t("aiHarness.evidenceReviewer.accepted")}</SelectItem><SelectItem value="rejected">{t("aiHarness.evidenceReviewer.rejected")}</SelectItem></> : <><SelectItem value="supported">{t("aiHarness.evidenceReviewer.supported")}</SelectItem><SelectItem value="qualified">{t("aiHarness.evidenceReviewer.qualified")}</SelectItem><SelectItem value="unsupported">{t("aiHarness.evidenceReviewer.unsupported")}</SelectItem></>}</SelectGroup></SelectContent></Select></Field>
                <Field><FieldLabel htmlFor="review-note">{t("aiHarness.evidenceReviewer.reviewNote")}</FieldLabel><Textarea id="review-note" maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></Field>
              </FieldGroup>
              <Button type="submit" disabled={mutation.status === "loading"}><BookOpenCheck data-icon="inline-start" /> {t("aiHarness.evidenceReviewer.recordReview")}</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function EmptyReviewerState() {
  const { t } = useTranslation()
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{t("aiHarness.evidenceReviewer.noEvidenceSelected")}</EmptyTitle>
        <EmptyDescription>
          {t("aiHarness.evidenceReviewer.noEvidenceDescription")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ReviewerSkeleton() {
  return <div className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /><Skeleton className="h-40 w-full" /></div>
}

function InspectionResult({ inspection }: { inspection: EvidenceInspectionView }) {
  const { t } = useTranslation()
  const hasLineage = inspection.decisions.length + inspection.claims.length + inspection.passages.length + inspection.sources.length > 0
  if (!hasLineage) {
    return <Alert><AlertCircle /><AlertTitle>{t("aiHarness.evidenceReviewer.noLineageRecords")}</AlertTitle><AlertDescription>{t("aiHarness.evidenceReviewer.noLineageDescription")}</AlertDescription></Alert>
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{reviewTargetLabel(t, inspection.targetKind)} #{inspection.targetId}</CardTitle>
            <Badge variant={inspection.lineagePasses ? "default" : "destructive"}>{inspection.lineagePasses ? t("aiHarness.evidenceReviewer.lineagePasses") : t("aiHarness.evidenceReviewer.reviewRequired")}</Badge>
          </div>
        </CardHeader>
        {inspection.findings.length > 0 ? <CardContent><ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{inspection.findings.map((finding, index) => <li key={`${finding.code}-${index}`}><span className="font-medium">{finding.code || finding.severity}:</span> {finding.message}</li>)}</ul></CardContent> : null}
      </Card>

      {inspection.revisions.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("aiHarness.evidenceReviewer.stepRevisions")}</CardTitle><CardDescription>{t("aiHarness.evidenceReviewer.stepRevisionsDescription")}</CardDescription></CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-1 text-sm">
              {inspection.revisions.map((revision) => (
                <li key={revision.id} data-testid={`inspection-revision-${revision.id}`}>
                  {t("ai-harness.evidenceReviewQueuePanel.v")}{revision.version} · {revision.artifactRef} · {revision.componentKey} · {linkStateLabel(t, revision.linkState)} · {evidenceStatusLabel(t, revision.status)}
                  {revision.parentComponentId ? t("aiHarness.evidenceReviewer.fromRevision", { id: revision.parentComponentId }) : t("aiHarness.evidenceReviewer.originalRevision")}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {inspection.decisions.map((decision) => (
        <Card key={decision.id}><CardHeader><CardTitle className="text-base">{t("aiHarness.evidenceReviewer.decisionHeading", { id: decision.id, title: decision.title || t("aiHarness.evidenceReviewer.untitledDecision") })}</CardTitle><CardDescription>{evidenceStatusLabel(t, decision.status)}</CardDescription></CardHeader><CardContent className="text-sm leading-relaxed">{decision.rationale || t("aiHarness.evidenceReviewer.noRationale")}</CardContent></Card>
      ))}

      {inspection.claims.map((claim) => (
        <Card key={claim.id}><CardHeader><CardTitle className="text-base">{t("aiHarness.evidenceReviewer.claimHeading", { id: claim.id })}</CardTitle><CardDescription>{claimKindLabel(t, claim.kind)} · {evidenceMethodLabel(t, claim.verificationMethod)} · {evidenceOutcomeLabel(t, claim.verificationOutcome)}{claim.reviewerUid ? t("aiHarness.evidenceReviewer.reviewedBy", { reviewer: `${claim.reviewerUid.slice(0, 8)}…` }) : ""}</CardDescription></CardHeader><CardContent className="text-sm leading-relaxed">{claim.statement}</CardContent></Card>
      ))}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {inspection.passages.map((passage) => (
          <Card key={passage.id}><CardHeader><CardTitle className="text-base">{t("aiHarness.evidenceReviewer.passageHeading", { id: passage.id })}</CardTitle><CardDescription>{availabilityLabel(t, passage.availability)}{passage.coordinates.length > 0 ? ` · ${passage.coordinates.join(", ")}` : ""}</CardDescription></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed">{passage.excerpt ?? t("aiHarness.evidenceReviewer.excerptUnavailable")}{passage.excerptTruncated ? " …" : ""}</p></CardContent></Card>
        ))}
        {inspection.sources.map((source) => (
          <Card key={source.id}><CardHeader><CardTitle className="text-base">{t("aiHarness.evidenceReviewer.sourceHeading", { id: source.id })}</CardTitle><CardDescription>{source.outOfScope ? t("aiHarness.evidenceReviewer.outOfScope") : source.scope ?? t("aiHarness.evidenceReviewer.scopeUnknown")}</CardDescription></CardHeader><CardContent className="flex flex-col gap-1 text-sm">{source.outOfScope ? <p className="text-muted-foreground">{t("aiHarness.evidenceReviewer.sourceMetadataHidden")}</p> : <><p className="font-medium">{source.title ?? t("aiHarness.evidenceReviewer.untitledSource")}</p><p className="text-muted-foreground">{source.authors.length > 0 ? source.authors.join(", ") : source.authorAttribution === "unknown" ? t("aiHarness.evidenceReviewer.authorUnknown") : t("aiHarness.evidenceReviewer.noAuthor")}</p></>}</CardContent></Card>
        ))}
      </div>
    </div>
  )
}
