"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@lumiere/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import { parseProgramInputSchema, programInputFromControl, validateProgramInputs, type ProgramInputValue } from "../../../lib/work-program-inputs"
import { mapRunHistory, runHistoryRequest, type RunHistoryView } from "../ai-harness/run-history"

/** Internal presentation props, deliberately not a second public manifest contract.
 * A future admitted catalog adapter must supply these from the Rust-owned contract.
 * This component never starts, publishes, certifies or resumes an execution.
 */
export interface ReusableProgramCandidateView {
  title: string
  programKey: string
  versionLabel: string
  applicationContract: string
  graphHash: string
  inputSchema: unknown
}
export interface ReusableProgramReviewProps {
  scope: { organizationId: string; companyId: number; actorIdentity: string; authorizationRevision: string }
  candidate: ReusableProgramCandidateView
  onInspectRun?: (runId: number) => void
}

/** Source-only review surface. It is intentionally absent from public module discovery. */
export function ReusableProgramReview(props: ReusableProgramReviewProps) {
  // A scope or immutable candidate change destroys input and asynchronous read state.
  const identity = JSON.stringify([props.scope, props.candidate])
  return <ScopedProgramReview key={identity} {...props} />
}

function ScopedProgramReview({ scope, candidate, onInspectRun }: ReusableProgramReviewProps) {
  const id = useId()
  const schema = parseProgramInputSchema(candidate.inputSchema)
  const [inputs, setInputs] = useState<Record<string, ProgramInputValue>>({})
  const [inputMessage, setInputMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<RunHistoryView | null>(null)
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle")
  const abort = useRef<AbortController | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1; abort.current?.abort() }, [])
  const validScope = /^[1-9]\d*$/.test(scope.organizationId) && Number.isSafeInteger(scope.companyId) && scope.companyId > 0 && Boolean(scope.actorIdentity.trim()) && scope.actorIdentity !== "unknown" && Boolean(scope.authorizationRevision.trim())

  async function loadHistory() {
    if (!validScope) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const requestGeneration = ++generation.current
    setHistory(null)
    setHistoryStatus("loading")
    try {
      const response = await fetch("/api/ai/evidence/runs/history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runHistoryRequest(scope.companyId, null)), signal: controller.signal,
      })
      if (!response.ok) throw new Error("History unavailable")
      const payload: unknown = await response.json()
      const result = mapRunHistory(payload)
      // Existing history projection drops malformed rows; do not label such a reply complete.
      const raw = payload && typeof payload === "object" && "runs" in payload ? payload.runs : null
      if (!result || !Array.isArray(raw) || raw.length > 50 || raw.length !== result.runs.length) throw new Error("Incomplete history")
      if (controller.signal.aborted || generation.current !== requestGeneration) return
      setHistory(result)
      setHistoryStatus("loaded")
    } catch {
      if (controller.signal.aborted || generation.current !== requestGeneration) return
      setHistory(null)
      setHistoryStatus("error")
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle>{candidate.title}</CardTitle>
      <CardDescription>Candidate reusable report. Execution and publication are unavailable pending released program contracts and runtime admission.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      <dl className="grid gap-2 text-sm">
        <div><dt className="font-medium">Program version</dt><dd>{candidate.programKey} · {candidate.versionLabel}</dd></div>
        <div><dt className="font-medium">Application contract</dt><dd className="break-all">{candidate.applicationContract}</dd></div>
        <div><dt className="font-medium">Graph hash</dt><dd className="break-all font-mono text-xs">{candidate.graphHash}</dd></div>
      </dl>
      {!schema ? <p role="alert">This input schema is unsupported. Inputs cannot be checked or submitted.</p> : <form onSubmit={(event) => {
        event.preventDefault()
        const result = validateProgramInputs(schema, inputs)
        setInputMessage(result.valid ? "Inputs match the declared schema. This does not start or publish a report." : result.errors.join(" "))
      }} className="space-y-3">
        {schema.fields.map((field) => <div key={field.key} className="space-y-1">
          <Label htmlFor={`${id}-${field.key}`}>{field.label}{field.required ? " (required)" : ""}</Label>
          {field.enum || field.type === "boolean" ? <Select value={inputs[field.key] === undefined ? "unset" : String((field.enum ?? [true, false]).indexOf(inputs[field.key]!))} onValueChange={(raw) => {
            const value = raw === "unset" ? undefined : (field.enum ?? [true, false])[Number(raw)]
            setInputs((current) => { const next = { ...current }; if (value === undefined) delete next[field.key]; else next[field.key] = value; return next })
            setInputMessage(null)
          }}>
            <SelectTrigger id={`${id}-${field.key}`}><SelectValue placeholder="Choose a value" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Choose a value</SelectItem>
              {(field.enum ?? [true, false]).map((option, index) => <SelectItem key={String(option)} value={String(index)}>{option === "" ? "Empty text" : String(option)}</SelectItem>)}
            </SelectContent>
          </Select> : <Input id={`${id}-${field.key}`} type={field.format === "date" ? "date" : "text"} inputMode={field.type === "integer" || field.type === "number" ? "decimal" : undefined} value={inputs[field.key] === undefined ? "" : String(inputs[field.key])} onChange={(event) => {
            const value = programInputFromControl(field, event.target.value)
            setInputs((current) => { const next = { ...current }; if (value === undefined) delete next[field.key]; else next[field.key] = value; return next })
            setInputMessage(null)
          }} />}
        </div>)}
        <Button type="submit" variant="outline">Check inputs</Button>
        {inputMessage ? <p role="status" className="text-sm">{inputMessage}</p> : null}
      </form>}
      <Button type="button" disabled>Run program</Button>
      <section className="space-y-2" aria-label="Existing governed runs">
        <h3 className="font-medium">Existing governed runs</h3>
        <p className="text-sm text-muted-foreground">These runs are not verified as executions of this candidate version.</p>
        <Button type="button" variant="outline" disabled={!validScope || historyStatus === "loading"} onClick={() => void loadHistory()}>Load existing runs</Button>
        {historyStatus === "loading" ? <p role="status">Loading authorized run history…</p> : null}
        {historyStatus === "error" ? <p role="alert">Run history is unavailable. No outcome has been inferred.</p> : null}
        {historyStatus === "loaded" && history?.runs.length === 0 ? <p>No governed runs were returned.</p> : null}
        {history?.runs.map((run) => <div key={run.runId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
          <span>Run #{run.runId} · {run.status} · {run.stepCount} steps</span>
          {onInspectRun ? <Button type="button" variant="outline" onClick={() => onInspectRun(run.runId)}>View run #{run.runId}</Button> : null}
        </div>)}
        {history?.nextCursor ? <p className="text-sm text-muted-foreground">More history is available through the existing run inspector.</p> : null}
      </section>
    </CardContent>
  </Card>
}
