"use client"

import type { JsonObject } from "@lumiere/api-client/json-object"

import { type FormEvent, useMemo, useState } from "react"
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

export function RunLifecyclePanel({ companies }: RunLifecyclePanelProps) {
  const companyOptions = useMemo(() => companyRowsToSelectOptions(companies), [companies])
  const [companyId, setCompanyId] = useState(() => companyOptions[0]?.value ?? "")
  const [runId, setRunId] = useState("")
  const [request, setRequest] = useState<RequestState>({ status: "idle" })
  const loading = request.status === "loading"

  const submit = async (intent: LifecycleIntent) => {
    const parsedCompanyId = Number(companyId)
    if (!Number.isSafeInteger(parsedCompanyId) || parsedCompanyId <= 0) {
      setRequest({ status: "error", message: "Choose a company first." })
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
      if (response.status === 401 || response.status === 403) {
        setRequest({ status: "denied", message: "This run is unavailable to the current session." })
        return
      }
      if (!response.ok) {
        setRequest({
          status: "error",
          message: response.status === 404 ? "No authorized run was found." : "The run operation could not be completed.",
        })
        return
      }
      const mapped = mapRunLifecycle(payload)
      setRequest(mapped
        ? { status: "success", data: mapped }
        : { status: "error", message: "The lifecycle response was incomplete." })
    } catch {
      setRequest({ status: "error", message: "The lifecycle service is unavailable." })
    }
  }

  const inspect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedRunId = Number(runId)
    if (!Number.isSafeInteger(parsedRunId) || parsedRunId <= 0) {
      setRequest({ status: "error", message: "Enter a positive run ID." })
      return
    }
    void submit({ kind: "inspect", runId: parsedRunId })
  }

  const changeRun = (update: () => void) => {
    update()
    setRequest({ status: "idle" })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <MessagesSquare />
          <h2 className="text-xl font-semibold tracking-tight">Run lifecycle</h2>
          <Badge variant="outline">Authenticated session</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Inspect and steer durable AI runs without supplying organization, identity, or credentials.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Inspect a run</CardTitle><CardDescription>Company access and run ownership are rechecked on the server.</CardDescription></CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 md:flex-row md:items-end" onSubmit={inspect}>
            <Field className="flex-1">
              <FieldLabel>Company</FieldLabel>
              <Select value={companyId} onValueChange={(value) => changeRun(() => setCompanyId(value))} disabled={loading || companyOptions.length === 0}>
                <SelectTrigger><SelectValue placeholder="Select company…" /></SelectTrigger>
                <SelectContent>{companyOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="lifecycle-run-id">Run ID</FieldLabel>
              <Input id="lifecycle-run-id" inputMode="numeric" pattern="[0-9]*" value={runId} disabled={loading} onChange={(event) => changeRun(() => setRunId(event.target.value))} />
            </Field>
            <Button type="submit" disabled={loading || !companyId || !runId}>Inspect</Button>
          </form>
        </CardContent>
      </Card>

      {request.status === "idle" ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Inspect an authorized run to view questions, events, and available controls.</CardContent></Card> : null}
      {request.status === "loading" ? <div className="flex flex-col gap-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-52 w-full" /></div> : null}
      {request.status === "denied" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Access denied</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert> : null}
      {request.status === "error" ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Lifecycle unavailable</AlertTitle><AlertDescription>{request.message}</AlertDescription></Alert> : null}
      {request.status === "success" ? <LifecycleResult data={request.data} loading={loading} submit={submit} /> : null}
    </div>
  )
}

function LifecycleResult({ data, loading, submit }: { data: RunLifecycleView; loading: boolean; submit: (intent: LifecycleIntent) => Promise<void> }) {
  const [command, setCommand] = useState<CommandKind>("resume")
  const [primary, setPrimary] = useState("")
  const [secondary, setSecondary] = useState("")
  const [selectedQuestion, setSelectedQuestion] = useState("")
  const [rightRunId, setRightRunId] = useState("")
  const [rightHash, setRightHash] = useState("")
  const [rightCursor, setRightCursor] = useState("")
  const [rightVersion, setRightVersion] = useState("")
  const continuation = data.continuation

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
        <CardHeader><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">Run #{data.runId}</CardTitle><Badge>{data.state}</Badge>{continuation ? <Badge variant="outline">cursor {continuation.cursor}</Badge> : <Badge variant="destructive">No continuation</Badge>}</div></CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Questions</CardTitle><CardDescription>Answer contents are intentionally not displayed.</CardDescription></CardHeader>
          <CardContent>{data.questions.length === 0 ? <p className="text-sm text-muted-foreground">No questions.</p> : <ul className="flex flex-col gap-3">{data.questions.map((question) => <li key={question.id} className="rounded-md border p-3 text-sm"><div className="flex gap-2"><span className="font-medium">{question.prompt}</span>{question.required ? <Badge variant="destructive">Required</Badge> : null}</div><p className="text-muted-foreground">{question.status} · revision {question.revision}{question.answered ? " · answered" : ""}</p></li>)}</ul>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Events</CardTitle></CardHeader>
          <CardContent>{data.events.length === 0 ? <p className="text-sm text-muted-foreground">No observable events.</p> : <ul className="flex flex-col gap-3">{data.events.map((event) => <li key={event.id} className="text-sm"><p className="font-medium">{event.eventKind}</p><p>{event.summary}</p><p className="text-xs text-muted-foreground">{event.createdAt}</p></li>)}</ul>}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Run control</CardTitle><CardDescription>Every command uses the latest returned continuation token.</CardDescription></CardHeader>
        <CardContent>
          {!continuation ? <Alert><AlertCircle /><AlertTitle>Controls unavailable</AlertTitle><AlertDescription>This response has no valid continuation.</AlertDescription></Alert> : (
            <form className="flex flex-col gap-4" onSubmit={execute}>
              <Field><FieldLabel>Command</FieldLabel><Select value={command} onValueChange={(value) => setCommand(value as CommandKind)} disabled={loading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ask">Ask question</SelectItem><SelectItem value="reply">Reply</SelectItem><SelectItem value="steer">Steer</SelectItem><SelectItem value="interrupt">Interrupt</SelectItem><SelectItem value="resume">Resume</SelectItem><SelectItem value="fork">Fork</SelectItem><SelectItem value="compare">Compare</SelectItem></SelectContent></Select></Field>
              <CommandFields command={command} questions={data.questions} primary={primary} secondary={secondary} setPrimary={setPrimary} setSecondary={setSecondary} selectedQuestion={selectedQuestion} setSelectedQuestion={setSelectedQuestion} right={{ runId: rightRunId, hash: rightHash, cursor: rightCursor, version: rightVersion }} setRight={{ runId: setRightRunId, hash: setRightHash, cursor: setRightCursor, version: setRightVersion }} />
              <Button type="submit" disabled={loading}>{command === "interrupt" ? <PauseCircle /> : command === "compare" ? <GitCompareArrows /> : <PlayCircle />} Execute {command}</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {data.comparison ? <Card><CardHeader><CardTitle className="text-base">Comparison</CardTitle></CardHeader><CardContent className="text-sm"><p>Run #{data.comparison.leftRunId} at cursor {data.comparison.leftContinuation.cursor} compared with run #{data.comparison.rightRunId} at cursor {data.comparison.rightContinuation.cursor}.</p><p className="mt-1 text-muted-foreground">The current core response confirms the compared continuations but does not yet expose bounded component, evidence, or validation differences.</p></CardContent></Card> : null}
    </div>
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
  if (command === "resume") return null
  if (command === "compare") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>Other run ID</FieldLabel><Input inputMode="numeric" value={right.runId} onChange={(event) => setRight.runId(event.target.value)} /></Field><Field><FieldLabel>Other checkpoint hash</FieldLabel><Input value={right.hash} maxLength={64} onChange={(event) => setRight.hash(event.target.value)} /></Field><Field><FieldLabel>Other cursor</FieldLabel><Input inputMode="numeric" value={right.cursor} onChange={(event) => setRight.cursor(event.target.value)} /></Field><Field><FieldLabel>Other concurrency version</FieldLabel><Input inputMode="numeric" value={right.version} onChange={(event) => setRight.version(event.target.value)} /></Field></FieldGroup>
  if (command === "reply") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>Question</FieldLabel><Select value={selectedQuestion} onValueChange={setSelectedQuestion}><SelectTrigger><SelectValue placeholder="Select question…" /></SelectTrigger><SelectContent>{questions.map((question) => <SelectItem key={question.id} value={String(question.id)}>{question.questionKey || `Question ${question.id}`}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel>Answer</FieldLabel><Input value={primary} maxLength={2_000} onChange={(event) => setPrimary(event.target.value)} /></Field></FieldGroup>
  if (command === "ask") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>Question key</FieldLabel><Input value={primary} maxLength={128} onChange={(event) => setPrimary(event.target.value)} /></Field><Field><FieldLabel>Prompt</FieldLabel><Input value={secondary} maxLength={2_000} onChange={(event) => setSecondary(event.target.value)} /></Field></FieldGroup>
  if (command === "fork") return <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field><FieldLabel>Fork key</FieldLabel><Input value={primary} maxLength={128} onChange={(event) => setPrimary(event.target.value)} /></Field><Field><FieldLabel>Child run key</FieldLabel><Input value={secondary} maxLength={128} onChange={(event) => setSecondary(event.target.value)} /></Field></FieldGroup>
  return <Field><FieldLabel>{command === "interrupt" ? "Reason" : "Instruction"}</FieldLabel><Input value={primary} maxLength={2_000} onChange={(event) => setPrimary(event.target.value)} /></Field>
}
