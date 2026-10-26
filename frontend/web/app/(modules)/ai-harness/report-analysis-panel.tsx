"use client"

import { useRef, useState, type FormEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useAiAgents } from "@lumiere/query-hooks/hooks/ai-agents"
import { useAiReportAnalysis } from "@lumiere/query-hooks/hooks/ai-skills"
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
    agent.isActive && Number(agent.organizationId) === Number(organizationId) &&
    (agent.companyId == null || String(agent.companyId) === companyId),
  )
  const selectedAgent = availableAgents.find((agent) => String(agent.id) === agentId)
  const ready = !!companyId && !!selectedAgent && query.trim().length > 0 && !agents.isError && !agents.isPending

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || submitting.current) return
    submitting.current = true
    try {
      await analysis.mutateAsync({ companyId: Number(companyId), agentId: Number(selectedAgent!.id), inputs: { query: query.trim() }, maxSteps: 5 })
    } catch {
      // The mutation records the error. Do not resubmit an uncertain outcome.
    } finally {
      submitting.current = false
    }
  }

  const run = analysis.data?.run
  return <div className="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>{t("aiHarness.reportAnalysis.title")}</CardTitle>
        <CardDescription>{t("aiHarness.reportAnalysis.description")}</CardDescription>
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
            <Textarea id="report-analysis-query" value={query} onChange={(event) => { setQuery(event.target.value); analysis.reset() }} disabled={analysis.isPending} maxLength={4000} required rows={4} />
          </Field>
          <p className="text-sm text-muted-foreground">{t("aiHarness.reportAnalysis.spendNotice")}</p>
          <Button type="submit" disabled={!ready || analysis.isPending}>{t(analysis.isPending ? "aiHarness.reportAnalysis.running" : "aiHarness.reportAnalysis.run")}</Button>
        </form>
      </CardContent>
    </Card>
    {analysis.isError && <Alert variant="destructive"><AlertDescription>
      <p>{t("aiHarness.reportAnalysis.failed")}</p>
      <a className="underline" href="/ai-harness?tab=run-lifecycle">{t("aiHarness.reportAnalysis.history")}</a>
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
