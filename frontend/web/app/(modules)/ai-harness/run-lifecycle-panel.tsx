"use client"

import type { JsonObject } from "@lumiere/api-client/json-object"

import { type FormEvent, useMemo, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { AlertCircle, GitCompareArrows, MessagesSquare, PauseCircle, PlayCircle } from "lucide-react"
import { Button } from "@lumiere/ui"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Field, FieldGroup, FieldLabel } from "@lumiere/ui/components/field"
import { Input } from "@lumiere/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import { Skeleton } from "@lumiere/ui/components/skeleton"

import { companyRowsToSelectOptions } from "@/lib/form-lookup"
import {
  lifecycleRequest,
  mapContinuation,
  mapRunLifecycle,
  type LifecycleIntent,
  type RunLifecycleView,
} from "./run-lifecycle"
import { mapRunObservation, type RunObservationView } from "./run-observation"
import { RunHistoryPanel } from "./run-history-panel"
import { eventKindLabel, questionStatusLabel, runStatusLabel } from "./enum-labels"

interface RunLifecyclePanelProps {
  companies: JsonObject[]
}

type CommandKind = "ask" | "reply" | "steer" | "interrupt" | "resume" | "fork" | "compare"
type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "denied"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; data: RunLifecycleView }
type ObservationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "success"; data: RunObservationView }

export function RunLifecyclePanel({ companies }: RunLifecyclePanelProps) {
  const { t } = useTranslation()
  const companyOptions = useMemo(() => companyRowsToSelectOptions(companies), [companies])
  const [companyId, setCompanyId] = useState(() => companyOptions[0]?.value ?? "")
  const [runId, setRunId] = useState("")
  const [request, setRequest] = useState<RequestState>({ status: "idle" })
  const [observation, setObservation] = useState<ObservationState>({ status: "idle" })
  const lifecycleRequestId = useRef(0)
  const observationRequest = useRef(0)
  const loading = request.status === "loading"

  const loadObservation = async (selectedCompanyId: number, selectedRunId: number) => {
    const requestId = ++observationRequest.current
    setObservation({ status: "loading" })
    try {
      const response = await fetch("/api/ai/evidence/runs/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId, runId: selectedRunId }),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (requestId !== observationRequest.current) return
      if (!response.ok) {
        setObservation({
          status: "unavailable",
          message: response.status === 401 || response.status === 403
            ? t("aiHarness.runLifecycle.errors.transcriptUnauthorized")
            : response.status === 404
              ? t("aiHarness.runLifecycle.errors.transcriptNotFound")
              : t("aiHarness.runLifecycle.errors.transcriptUnavailable"),
        })
        return
      }
      const mapped = mapRunObservation(payload)
      setObservation(mapped && mapped.runId === selectedRunId
        ? { status: "success", data: mapped }
        : { status: "unavailable", message: t("aiHarness.runLifecycle.errors.transcriptIncomplete") })
    } catch {
      if (requestId === observationRequest.current) {
        setObservation({ status: "unavailable", message: t("aiHarness.runLifecycle.errors.transcriptUnavailable") })
      }
    }
  }

  const submit = async (intent: LifecycleIntent) => {
    const requestId = ++lifecycleRequestId.current
    observationRequest.current += 1
    const parsedCompanyId = Number(companyId)
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0) {
      setRequest({ status: "error", message: t("aiHarness.runLifecycle.errors.chooseCompany") })
      return
    }
    setRequest({ status: "loading" })
    try {
      const response = await fetch("/api/ai/runs/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lifecycleRequest(parsedCompanyId, intent)),
      })
      const payload = await response.json().catch(() => ({})) as JsonObject
      if (requestId !== lifecycleRequestId.current) return
      if (response.status === 401 || response.status === 403) {
        setRequest({ status: "denied", message: t("aiHarness.runLifecycle.errors.runDenied") })
        return
      }
      if (!response.ok) {
        setRequest({
          status: "error",
          message: response.status === 404 ? t("aiHarness.runLifecycle.errors.runNotFound") : t("aiHarness.runLifecycle.errors.operationFailed"),
        })
        return
      }
      const mapped = mapRunLifecycle(payload)
      if (!mapped) {
        setRequest({ status: "error", message: t("aiHarness.runLifecycle.errors.responseIncomplete") })
        setObservation({ status: "idle" })
        return
      }
      setRequest({ status: "success", data: mapped })
      await loadObservation(parsedCompanyId, mapped.runId)
    } catch {
      if (requestId !== lifecycleRequestId.current) return
      setRequest({ status: "error", message: t("aiHarness.runLifecycle.errors.serviceUnavailable") })
      setObservation({ status: "idle" })
    }
  }

  const inspect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedRunId = Number(runId)
    if (!Number.isSafeInteger(parsedRunId) || parsedRunId <= 0) {
      setRequest({ status: "error", message: t("aiHarness.runLifecycle.errors.positiveRunId") })
      return
    }
    void submit({ kind: "inspect", runId: parsedRunId })
  }

  const inspectHistoryRun = (selectedRunId: number) => {
    setRunId(String(selectedRunId))
    void submit({ kind: "inspect", runId: selectedRunId })
  }

  const changeRun = (update: () => void) => {
    lifecycleRequestId.current += 1
    observationRequest.current += 1
    update()
    setRequest({ status: "idle" })
    setObservation({ status: "idle" })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <MessagesSquare />
          <h2 className="text-xl font-semibold tracking-tight">{t("aiHarness.runLifecycle.title")}</h2>
          <Badge variant="outline">{t("aiHarness.runLifecycle.authenticatedSession")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t("aiHarness.runLifecycle.description")}</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("aiHarness.runLifecycle.inspectTitle")}</CardTitle><CardDescription>{t("aiHarness.runLifecycle.inspectDescription")}</CardDescription></CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 md:flex-row md:items-end" onSubmit={inspect}>
            <Field className="flex-1">
              <FieldLabel>{t("aiHarness.runLifecycle.company")}</FieldLabel>
              <Select value={companyId} onValueChange={(value) => changeRun(() => setCompanyId(value))} disabled={loading || companyOptions.length === 0}>
                <SelectTrigger><SelectValue placeholder={t("aiHarness.runLifecycle.companyPlaceholder")} /></SelectTrigger>
                <SelectContent>{companyOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="lifecycle-run-id">{t("aiHarness.runLifecycle.runId")}</FieldLabel>
              <Input id="lifecycle-run-id" inputMode="numeric" pattern="[0-9]*" value={runId} disabled={loading} onChange={(event) => changeRun(() => setRunId(event.target.value))} />
            </Field>
            <Button type="submit" disabled={loading || !companyId || !runId}>{t("aiHarness.runLifecycle.inspect")}</Button>
          </form>
        </CardContent>
      </Card>

      <RunHistoryPanel key={companyId} companyId={Number(companyId) || null} onInspect={inspectHistoryRun} />

      {request.status === "idle" ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("aiHarness.runLifecycle.idle")}</CardContent></Card> : null}
      {request.status === "loading" ? <div className="flex flex-col gap-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-52 w-full" /></div> : null}
      {request.status === "denied" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("aiHarness.runLifecycle.accessDenied")}</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert> : null}
      {request.status === "error" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>{t("aiHarness.runLifecycle.unavailable")}</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert> : null}
      {request.status === "success" ? <LifecycleResult data={request.data} observation={observation} loading={loading} submit={submit} /> : null}
    </div>
  )
}

function LifecycleResult({ data, observation, loading, submit }: { data: RunLifecycleView; observation: ObservationState; loading: boolean; submit: (intent: LifecycleIntent) => Promise<void> }) {
  const { t } = useTranslation()
  const [command, setCommand] = useState<CommandKind>("resume")
  const [primary, setPrimary] = useState("")
  const [secondary, setSecondary] = useState("")
  const [selectedQuestion, setSelectedQuestion] = useState("")
  const [rightRunId, setRightRunId] = useState("")
  const [rightHash, setRightHash] = useState("")
  const [rightCursor, setRightCursor] = useState("")
  const [rightVersion, setRightVersion] = useState("")
  const continuation = data.continuation
  const commandLabels = {
    ask: t("aiHarness.runLifecycle.commands.ask"),
    compare: t("aiHarness.runLifecycle.commands.compare"),
    fork: t("aiHarness.runLifecycle.commands.fork"),
    interrupt: t("aiHarness.runLifecycle.commands.interrupt"),
    reply: t("aiHarness.runLifecycle.commands.reply"),
    resume: t("aiHarness.runLifecycle.commands.resume"),
    steer: t("aiHarness.runLifecycle.commands.steer"),
  } satisfies Record<CommandKind, string>

  const execute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!continuation) return
    const idempotencyKey = crypto.randomUUID()
    let intent: LifecycleIntent | null = null
    if (command === "resume") intent = { kind: "resume", continuation, idempotencyKey }
    if (command === "interrupt" && primary.trim()) intent = { kind: "interrupt", continuation, reason: primary.trim(), idempotencyKey }
    if (command === "steer" && primary.trim()) intent = { kind: "steer", continuation, instruction: primary.trim(), idempotencyKey }
    if (command === "ask" && primary.trim() && secondary.trim()) intent = { kind: "ask", continuation, questionKey: primary.trim(), prompt: secondary.trim(), responseSchemaJson: { type: "string" }, required: true, idempotencyKey }
    if (command === "fork" && primary.trim() && secondary.trim()) intent = { kind: "fork", continuation, forkKey: primary.trim(), childRunKey: secondary.trim(), idempotencyKey }
    if (command === "reply") {
      const question = data.questions.find((item) => String(item.id) === selectedQuestion)
      if (question && primary.trim()) intent = { kind: "reply", continuation, questionId: question.id, expectedQuestionRevision: question.revision, answer: { text: primary.trim() }, idempotencyKey }
    }
    if (command === "compare") {
      const right = mapContinuation({ runId: Number(rightRunId), checkpointHash: rightHash, cursor: Number(rightCursor), concurrencyVersion: Number(rightVersion) })
      if (right) intent = { kind: "compare", continuation, rightRunId: right.runId, right, idempotencyKey }
    }
    if (intent) void submit(intent)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{t("aiHarness.runLifecycle.runNumber", { id: data.runId })}</CardTitle><Badge>{runStatusLabel(t, data.state)}</Badge>{continuation ? <Badge variant="outline">{t("aiHarness.runLifecycle.cursor", { cursor: continuation.cursor })}</Badge> : <Badge variant="destructive">{t("aiHarness.runLifecycle.noContinuation")}</Badge>}</div></CardHeader>
      </Card>

      <RunObservation observation={observation} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{t("aiHarness.runLifecycle.questions")}</CardTitle><CardDescription>{t("aiHarness.runLifecycle.answersHidden")}</CardDescription></CardHeader>
          <CardContent>{data.questions.length === 0 ? <p className="text-sm text-muted-foreground">{t("aiHarness.runLifecycle.noQuestions")}</p> : <ul className="flex flex-col gap-3">{data.questions.map((question) => <li key={question.id} className="rounded-md border p-3 text-sm"><div className="flex gap-2"><span className="font-medium">{question.prompt}</span>{question.required ? <Badge variant="destructive">{t("aiHarness.runLifecycle.required")}</Badge> : null}</div><p className="text-muted-foreground">{t("aiHarness.runLifecycle.questionStatus", { status: questionStatusLabel(t, question.status), revision: question.revision, answered: question.answered ? t("aiHarness.runLifecycle.answeredSuffix") : "" })}</p></li>)}</ul>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{t("aiHarness.runLifecycle.events")}</CardTitle></CardHeader>
          <CardContent>{data.events.length === 0 ? <p className="text-sm text-muted-foreground">{t("aiHarness.runLifecycle.noEvents")}</p> : <ul className="flex flex-col gap-3">{data.events.map((event) => <li key={event.id} className="text-sm"><p className="font-medium">{eventKindLabel(t, event.eventKind)}</p><p>{event.summary}</p><p className="text-xs text-muted-foreground">{event.createdAt}</p></li>)}</ul>}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("aiHarness.runLifecycle.controlTitle")}</CardTitle><CardDescription>{t("aiHarness.runLifecycle.controlDescription")}</CardDescription></CardHeader>
        <CardContent>
          {!continuation ? <Alert><AlertCircle /><AlertTitle>{t("aiHarness.runLifecycle.controlsUnavailable")}</AlertTitle><AlertDescription>{t("aiHarness.runLifecycle.noValidContinuation")}</AlertDescription></Alert> : (
            <form className="flex flex-col gap-4" onSubmit={execute}>
              <Field><FieldLabel>{t("aiHarness.runLifecycle.command")}</FieldLabel><Select value={command} onValueChange={(value) => setCommand(value as CommandKind)} disabled={loading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ask">{t("aiHarness.runLifecycle.commands.ask")}</SelectItem><SelectItem value="reply">{t("aiHarness.runLifecycle.commands.reply")}</SelectItem><SelectItem value="steer">{t("aiHarness.runLifecycle.commands.steer")}</SelectItem><SelectItem value="interrupt">{t("aiHarness.runLifecycle.commands.interrupt")}</SelectItem><SelectItem value="resume">{t("aiHarness.runLifecycle.commands.resume")}</SelectItem><SelectItem value="fork">{t("aiHarness.runLifecycle.commands.fork")}</SelectItem><SelectItem value="compare">{t("aiHarness.runLifecycle.commands.compare")}</SelectItem></SelectContent></Select></Field>
              <CommandFields command={command} questions={data.questions} primary={primary} secondary={secondary} setPrimary={setPrimary} setSecondary={setSecondary} selectedQuestion={selectedQuestion} setSelectedQuestion={setSelectedQuestion} right={{ runId: rightRunId, hash: rightHash, cursor: rightCursor, version: rightVersion }} setRight={{ runId: setRightRunId, hash: setRightHash, cursor: setRightCursor, version: setRightVersion }} />
              <Button type="submit" disabled={loading}>{command === "interrupt" ? <PauseCircle /> : command === "compare" ? <GitCompareArrows /> : <PlayCircle />} {t("aiHarness.runLifecycle.executeCommand", { command: commandLabels[command] })}</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {data.comparison ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("aiHarness.runLifecycle.comparison")}</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <p>{t("aiHarness.runLifecycle.comparisonSummary", { leftRunId: data.comparison.leftRunId, leftCursor: data.comparison.leftContinuation.cursor, rightRunId: data.comparison.rightRunId, rightCursor: data.comparison.rightContinuation.cursor })}</p>
            {data.comparison.details ? (
              <div className="mt-3 flex flex-col gap-2 text-muted-foreground">
                <p>Left: {data.comparison.details.leftStatus}, {data.comparison.details.leftStepCount} steps, {data.comparison.details.leftTokensUsed.toLocaleString()} tokens.</p>
                <p>Right: {data.comparison.details.rightStatus}, {data.comparison.details.rightStepCount} steps, {data.comparison.details.rightTokensUsed.toLocaleString()} tokens.</p>
                {data.comparison.details.toolsOnlyLeft.length > 0 ? <p>Only left: {data.comparison.details.toolsOnlyLeft.join(", ")}.</p> : null}
                {data.comparison.details.toolsOnlyRight.length > 0 ? <p>Only right: {data.comparison.details.toolsOnlyRight.join(", ")}.</p> : null}
                {data.comparison.details.toolDiffTruncated ? <Badge variant="outline">Tool difference truncated</Badge> : null}
              </div>
            ) : <p className="mt-1 text-muted-foreground">No bounded comparison details were available.</p>}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function RunObservation({ observation }: { observation: ObservationState }) {
  const { t } = useTranslation()
  if (observation.status === "idle") return null
  if (observation.status === "loading") return <Skeleton className="h-48 w-full" />
  if (observation.status === "unavailable") {
    return <Alert><AlertCircle /><AlertTitle>{t("aiHarness.runLifecycle.transcriptUnavailable")}</AlertTitle><AlertDescription>{observation.message}</AlertDescription></Alert>
  }

  const run = observation.data
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("aiHarness.runLifecycle.transcriptTitle")}</CardTitle>
            <CardDescription>{t("aiHarness.runLifecycle.transcriptDescription")}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{runStatusLabel(t, run.status)}</Badge>
            <Badge variant="outline">{t("aiHarness.runLifecycle.stepCount", { count: run.stepCount })}</Badge>
            <Badge variant="outline">{t("aiHarness.runLifecycle.tokenCount", { count: run.tokensUsed })}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {run.economics ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            {run.economics.providerModels.map((pair) => <Badge key={`${pair.provider}:${pair.model}`} variant="outline">{pair.provider} / {pair.model}</Badge>)}
            {run.economics.providerModelsTruncated ? <Badge variant="outline">Provider list truncated</Badge> : null}
            {run.economics.attemptCount !== null ? <span>{run.economics.attemptCount} provider attempt{run.economics.attemptCount === 1 ? "" : "s"}</span> : null}
            {run.economics.inputTokens !== null && run.economics.outputTokens !== null ? <span>{run.economics.inputTokens.toLocaleString()} input / {run.economics.outputTokens.toLocaleString()} output tokens</span> : null}
            {run.economics.reservedUnits !== null ? <span>{run.economics.reservedUnits.toLocaleString()} {run.economics.currency ?? "units"} reserved</span> : null}
            {run.economics.settledUnits !== null ? <span>{run.economics.settledUnits.toLocaleString()} {run.economics.currency ?? "units"} settled</span> : null}
            {run.economics.attemptStatuses.map((status) => <Badge key={`attempt:${status}`} variant="outline">attempt {status}</Badge>)}
            {run.economics.reservationStatuses.map((status) => <Badge key={`reservation:${status}`} variant="outline">reservation {status}</Badge>)}
            {run.economics.outcomeUnknown ? <Badge variant="destructive">Outcome unknown</Badge> : null}
            {run.economics.truncated ? <Badge variant="outline">Economics truncated</Badge> : null}
          </div>
        ) : null}
        {run.transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("aiHarness.runLifecycle.noToolSteps")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {run.transcript.map((step) => (
              <li key={step.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t("aiHarness.runLifecycle.stepNumber", { number: step.stepNo })}</Badge>
                    <span className="font-medium">{step.toolName}</span>
                    {step.error ? <Badge variant="destructive">{t("aiHarness.runLifecycle.failed")}</Badge> : <Badge variant="outline">{t("aiHarness.runLifecycle.completed")}</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">{t("aiHarness.runLifecycle.durationMs", { duration: step.durationMs.toLocaleString() })}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{step.resultSummary}</span>
                  {step.inputHash ? <span title={step.inputHash}>{t("aiHarness.runLifecycle.inputHash", { hash: `${step.inputHash.slice(0, 12)}…` })}</span> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function CommandFields({ command, questions, primary, secondary, setPrimary, setSecondary, selectedQuestion, setSelectedQuestion, right, setRight }: {
  command: CommandKind
  questions: RunLifecycleView["questions"]
  primary: string
  secondary: string
  setPrimary: (value: string) => void
  setSecondary: (value: string) => void
  selectedQuestion: string
  setSelectedQuestion: (value: string) => void
  right: { runId: string; hash: string; cursor: string; version: string }
  setRight: { runId: (value: string) => void; hash: (value: string) => void; cursor: (value: string) => void; version: (value: string) => void }
}) {
  const { t } = useTranslation()
  if (command === "resume") return null
  if (command === "compare") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.otherRunId")}</FieldLabel><Input inputMode="numeric" value={right.runId} onChange={(event) => setRight.runId(event.target.value)} /></Field><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.otherCheckpointHash")}</FieldLabel><Input value={right.hash} maxLength={64} onChange={(event) => setRight.hash(event.target.value)} /></Field><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.otherCursor")}</FieldLabel><Input inputMode="numeric" value={right.cursor} onChange={(event) => setRight.cursor(event.target.value)} /></Field><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.otherConcurrencyVersion")}</FieldLabel><Input inputMode="numeric" value={right.version} onChange={(event) => setRight.version(event.target.value)} /></Field></FieldGroup>
  if (command === "reply") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.question")}</FieldLabel><Select value={selectedQuestion} onValueChange={setSelectedQuestion}><SelectTrigger><SelectValue placeholder={t("aiHarness.runLifecycle.fields.questionPlaceholder")} /></SelectTrigger><SelectContent>{questions.map((question) => <SelectItem key={question.id} value={String(question.id)}>{question.questionKey || t("aiHarness.runLifecycle.questionNumber", { id: question.id })}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.answer")}</FieldLabel><Input value={primary} maxLength={2_000} onChange={(event) => setPrimary(event.target.value)} /></Field></FieldGroup>
  if (command === "ask") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.questionKey")}</FieldLabel><Input value={primary} maxLength={128} onChange={(event) => setPrimary(event.target.value)} /></Field><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.prompt")}</FieldLabel><Input value={secondary} maxLength={2_000} onChange={(event) => setSecondary(event.target.value)} /></Field></FieldGroup>
  if (command === "fork") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.forkKey")}</FieldLabel><Input value={primary} maxLength={128} onChange={(event) => setPrimary(event.target.value)} /></Field><Field><FieldLabel>{t("aiHarness.runLifecycle.fields.childRunKey")}</FieldLabel><Input value={secondary} maxLength={128} onChange={(event) => setSecondary(event.target.value)} /></Field></FieldGroup>
  return <Field><FieldLabel>{command === "interrupt" ? t("aiHarness.runLifecycle.fields.reason") : t("aiHarness.runLifecycle.fields.instruction")}</FieldLabel><Input value={primary} maxLength={2_000} onChange={(event) => setPrimary(event.target.value)} /></Field>
}
