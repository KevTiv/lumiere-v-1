"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useAiAgents } from "@lumiere/query-hooks/hooks/ai-agents"
import { AiReportReadinessBlockedError, useAiReportAnalysis } from "@lumiere/query-hooks/hooks/ai-skills"
import { Button } from "@lumiere/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Field, FieldLabel } from "@lumiere/ui/components/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import { Textarea } from "@lumiere/ui/components/textarea"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { companyRowsToSelectOptions, type CompanyLookupRow } from "../../../lib/form-lookup"
import { runStatusLabel } from "./enum-labels"
import { SavedRunObservation } from "./run-observation-panel"
import { parseReportReadiness, type ReportReadiness } from "../../../lib/report-readiness"
import { isAgentAvailableForCompany } from "./agent-company-scope"

export function ReportAnalysisPanel({ organizationId, companies, savedRun }: {
  organizationId: bigint
  companies: readonly CompanyLookupRow[]
  savedRun?: { companyId: number; runId: number }
}) {
  const { t } = useTranslation()
  const companyOptions = companyRowsToSelectOptions(companies)
  const [companyId, setCompanyId] = useState(() =>
    companyOptions.find((company) => company.value === String(savedRun?.companyId))?.value ?? companyOptions[0]?.value ?? "",
  )
  const [agentId, setAgentId] = useState("")
  const [query, setQuery] = useState("")
  const agents = useAiAgents(Number(organizationId), organizationId > 0n)
  const analysis = useAiReportAnalysis()
  const submitting = useRef(false)
  const availableAgents = (agents.data ?? []).filter((agent) =>
    isAgentAvailableForCompany(agent, organizationId, companyId),
  )
  const selectedAgent = availableAgents.find((agent) => String(agent.id) === agentId)
  const [readiness, setReadiness] = useState<ReportReadiness | null>(null)
  const [readinessOrganization, setReadinessOrganization] = useState("")
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [readinessAttempt, setReadinessAttempt] = useState(0)
  const selectedAgentId = selectedAgent ? String(selectedAgent.id) : ""
  const matchingReadiness = readinessOrganization === String(organizationId) && readiness?.companyId === Number(companyId) && readiness.agentId === Number(selectedAgentId) ? readiness : null
  useEffect(() => {
    const controller = new AbortController()
    setReadiness(null)
    if (!companyId || !selectedAgentId) { setReadinessLoading(false); return () => controller.abort() }
    setReadinessLoading(true)
    void (async () => {
      let checked: ReportReadiness | null = null
      try {
        const response = await fetch("/api/ai/skills/report-analysis/readiness", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: Number(companyId), agentId: Number(selectedAgentId) }),
          signal: controller.signal,
        })
        if (response.ok) checked = parseReportReadiness(await response.json(), Number(companyId), Number(selectedAgentId))
      } catch { /* Render unavailable; never infer readiness from transport success. */ }
      if (!controller.signal.aborted) {
        setReadinessOrganization(String(organizationId))
        setReadiness(checked ?? { companyId: Number(companyId), agentId: Number(selectedAgentId), status: "blocked", code: "readiness_unavailable", billableCalls: 0 })
        setReadinessLoading(false)
      }
    })()
    return () => controller.abort()
  }, [organizationId, companyId, selectedAgentId, readinessAttempt])
  const ready = matchingReadiness?.status === "ready" && !!companyId && !!selectedAgent && query.trim().length > 0 && !agents.isError && !agents.isPending

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || submitting.current) return
    submitting.current = true
    try {
      await analysis.mutateAsync({ companyId: Number(companyId), agentId: Number(selectedAgent!.id), inputs: { query: query.trim() }, maxSteps: 5 })
    } catch (error) {
      if (error instanceof AiReportReadinessBlockedError) {
        const blocked = parseReportReadiness(error.readiness, Number(companyId), Number(selectedAgent!.id))
        if (blocked?.status === "blocked") { setReadinessOrganization(String(organizationId)); setReadiness(blocked) }
      }
      // The mutation records the error. Do not resubmit an uncertain outcome.
    } finally {
      submitting.current = false
    }
  }

  const blockedBeforeDispatch = analysis.error instanceof AiReportReadinessBlockedError
    ? parseReportReadiness(analysis.error.readiness, Number(companyId), Number(selectedAgentId)) : null
  const run = analysis.data?.run
  return <div className="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>{t("aiHarness.reportAnalysis.title")}</CardTitle>
        <CardDescription>{t("aiHarness.ux.reportAnalysis.description", { defaultValue: "Ask a question about this company’s reports, choose an available assistant, and review the answer against its sources." })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="report-analysis-company">{t("aiHarness.reportAnalysis.company")}</FieldLabel>
              <Select value={companyId} disabled={analysis.isPending} onValueChange={(value) => { setCompanyId(value); setAgentId(""); analysis.reset() }}>
                <SelectTrigger id="report-analysis-company"><SelectValue /></SelectTrigger>
                <SelectContent>{companyOptions.map((company) => <SelectItem key={company.value} value={company.value}>{company.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="report-analysis-agent">{t("aiHarness.reportAnalysis.agent")}</FieldLabel>
              <Select value={agentId} disabled={analysis.isPending || agents.isPending || agents.isError} onValueChange={(value) => { setAgentId(value); analysis.reset() }}>
                <SelectTrigger id="report-analysis-agent"><SelectValue placeholder={t("aiHarness.reportAnalysis.chooseAgent")} /></SelectTrigger>
                <SelectContent>{availableAgents.map((agent) => <SelectItem key={String(agent.id)} value={String(agent.id)}>{agent.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          {agents.isPending ? <p role="status">{t("aiHarness.reportAnalysis.loading")}</p> : agents.isError ?
            <Alert variant="destructive"><AlertDescription>{t("aiHarness.reportAnalysis.agentsUnavailable")}</AlertDescription></Alert> :
            availableAgents.length === 0 && <p role="status">{t("aiHarness.reportAnalysis.noAgents")}</p>}
          <Field>
            <FieldLabel htmlFor="report-analysis-query">{t("aiHarness.reportAnalysis.question")}</FieldLabel>
            <Textarea variant="plain" id="report-analysis-query" value={query} onChange={(event) => { setQuery(event.target.value); analysis.reset() }} disabled={analysis.isPending} maxLength={4000} required rows={4} />
          </Field>
          {selectedAgentId && <div aria-live="polite">
            {readinessLoading || !matchingReadiness ? <p role="status">{t("aiHarness.reportReadiness.checking")}</p> : matchingReadiness.status === "blocked" ?
              <Alert><AlertDescription>{t(`aiHarness.reportReadiness.${matchingReadiness.code}`)}</AlertDescription></Alert> :
              <p role="status">{t("aiHarness.reportReadiness.ready")}</p>}
            <Button type="button" variant="outline" disabled={readinessLoading || analysis.isPending} onClick={() => setReadinessAttempt((attempt) => attempt + 1)}>{t("aiHarness.reportReadiness.check")}</Button>
          </div>}
          <p className="text-sm text-muted-foreground">{t("aiHarness.reportAnalysis.spendNotice")}</p>
          <Button type="submit" disabled={!ready || analysis.isPending}>{t(analysis.isPending ? "aiHarness.reportAnalysis.running" : "aiHarness.reportAnalysis.run")}</Button>
        </form>
      </CardContent>
    </Card>
    {analysis.isError && <Alert variant="destructive"><AlertDescription>
      <p>{blockedBeforeDispatch?.status === "blocked" ? t(`aiHarness.reportReadiness.${blockedBeforeDispatch.code}`) : t("aiHarness.reportAnalysis.failed")}</p>
      {!blockedBeforeDispatch && <a className="underline" href="/ai-harness?tab=run-lifecycle">{t("aiHarness.reportAnalysis.history")}</a>}
    </AlertDescription></Alert>}
    {analysis.data && <Card>
      <CardHeader>
        <CardTitle>{t("aiHarness.reportAnalysis.result")}</CardTitle>
        {run && <Badge variant={run.status === "completed" ? "default" : "secondary"}>{runStatusLabel(t, run.status)}</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="whitespace-pre-wrap">{analysis.data.summary}</p>
        {run && run.run_id > 0 && <a className="underline" href={`/ai-harness?tab=report-analysis&companyId=${companyId}&runId=${run.run_id}`}>{t("aiHarness.reportAnalysis.inspect")}</a>}
      </CardContent>
    </Card>}
    {savedRun && String(savedRun.companyId) === companyId
      ? <SavedRunObservation key={`${companyId}:${savedRun.runId}`} companyId={savedRun.companyId} runId={savedRun.runId} />
      : null}
  </div>
}
