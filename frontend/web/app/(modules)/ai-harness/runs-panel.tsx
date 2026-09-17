"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  AiRunInspector,
  AiRunTranscript,
  aiRunStatusBadgeVariant,
  Button,
} from "@lumiere/ui"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@lumiere/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import {
  AlertCircle,
  Building2,
  FileSearch,
  RefreshCw,
  ScrollText,
} from "lucide-react"

import {
  AI_RUN_STATUSES,
  useAiInspector,
  useAiRunSteps,
  useAiRuns,
  type AiRunsFilters,
  type AiRunStatus,
  type CostInfo,
  type RunRow,
} from "@lumiere/query-hooks/hooks/ai-runs"
import { companyRowsToSelectOptions } from "@/lib/form-lookup"

interface RunsPanelProps {
  organizationId: bigint
  companies: Record<string, unknown>[]
}

const DAY_OPTIONS = [7, 14, 30] as const

const EMPTY_COST: CostInfo = {
  available: false,
  settled_units: null,
  reserved_units: null,
  currency: null,
}

function formatMicros(micros: number | null | undefined): string {
  if (micros == null || !Number.isFinite(micros)) return "—"
  return new Date(micros / 1000).toLocaleString()
}

function prettifyStatus(status: string): string {
  return status.replace(/_/g, " ")
}

/**
 * AIH-9 "Runs" admin tab: filterable list of recent AI agent runs across all
 * skills, with the AIH-7 live transcript and the AIH-16 inspector one click
 * away per run.
 */
export function RunsPanel({ companies }: RunsPanelProps) {
  const { t } = useTranslation()

  const [companyFilter, setCompanyFilter] = useState("all")
  const [skillFilter, setSkillFilter] = useState("all")
  const [agentFilter, setAgentFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [daysFilter, setDaysFilter] = useState("7")

  const [selectedRun, setSelectedRun] = useState<RunRow | null>(null)
  const [inspectView, setInspectView] = useState<"answer" | "claim">("answer")
  const [inspectCompanyId, setInspectCompanyId] = useState<number | null>(null)

  const companyOptions = useMemo(
    () => companyRowsToSelectOptions(companies),
    [companies],
  )

  const filters = useMemo<AiRunsFilters>(() => {
    const companyId =
      companyFilter !== "all" ? Number(companyFilter) : undefined
    const skillId = skillFilter !== "all" ? Number(skillFilter) : undefined
    const agentId = agentFilter !== "all" ? Number(agentFilter) : undefined
    const status =
      statusFilter !== "all" ? (statusFilter as AiRunStatus) : undefined
    const days = Number(daysFilter)
    return {
      ...(companyId != null && Number.isFinite(companyId) ? { companyId } : {}),
      ...(skillId != null && Number.isFinite(skillId) ? { skillId } : {}),
      ...(agentId != null && Number.isFinite(agentId) ? { agentId } : {}),
      ...(status != null ? { status } : {}),
      days: Number.isFinite(days) ? days : 7,
    }
  }, [companyFilter, skillFilter, agentFilter, statusFilter, daysFilter])

  const runsQuery = useAiRuns(filters)
  const runs = runsQuery.data ?? []

  // Skill/agent filters are populated from the distinct values in the runs.
  const skillOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const run of runs) {
      if (run.skill_id > 0) {
        byId.set(run.skill_id, run.skill_name ?? run.skill_key ?? `#${run.skill_id}`)
      }
    }
    return Array.from(byId.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => ({ value: String(id), label }))
  }, [runs])

  const agentOptions = useMemo(() => {
    const byId = new Map<number, string>()
    for (const run of runs) {
      if (run.agent_id > 0) {
        byId.set(run.agent_id, run.agent_name ?? `#${run.agent_id}`)
      }
    }
    return Array.from(byId.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => ({ value: String(id), label }))
  }, [runs])

  // AIH-7 live transcript: polls every 2s while the selected run is
  // pending/running (handled inside the hook).
  const stepsQuery = useAiRunSteps(
    selectedRun?.id ?? 0,
    selectedRun?.company_id ?? 0,
  )

  const inspector = useAiInspector()

  const handleInspectRun = (run: RunRow) => {
    setInspectView("answer")
    setInspectCompanyId(run.company_id)
    void inspector.mutate({
      viewKind: "answer",
      runId: run.id,
      companyId: run.company_id,
    })
  }

  const handleInspectClaim = (claimId: number) => {
    if (inspectCompanyId == null) return
    setInspectView("claim")
    void inspector.mutate({
      viewKind: "claim",
      claimId,
      companyId: inspectCompanyId,
    })
  }

  const inspectError =
    inspector.error != null
      ? inspector.error instanceof Error
        ? inspector.error.message
        : String(inspector.error)
      : null

  return (
    <div className="flex flex-col gap-6" data-testid="ai-harness-runs-panel">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("aiHarness.runs.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("aiHarness.runs.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("aiHarness.runs.filtersTitle")}
          </CardTitle>
          <CardDescription>
            {t("aiHarness.runs.filtersDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel>{t("aiHarness.runs.companyLabel")}</FieldLabel>
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger>
                  <Building2 data-icon="inline-start" />
                  <SelectValue
                    placeholder={t("aiHarness.runs.allCompanies")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("aiHarness.runs.allCompanies")}
                  </SelectItem>
                  {companyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("aiHarness.runs.skillLabel")}</FieldLabel>
              <Select value={skillFilter} onValueChange={setSkillFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={t("aiHarness.runs.allSkills")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("aiHarness.runs.allSkills")}
                  </SelectItem>
                  {skillOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("aiHarness.runs.agentLabel")}</FieldLabel>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={t("aiHarness.runs.allAgents")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("aiHarness.runs.allAgents")}
                  </SelectItem>
                  {agentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("aiHarness.runs.statusLabel")}</FieldLabel>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={t("aiHarness.runs.allStatuses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("aiHarness.runs.allStatuses")}
                  </SelectItem>
                  {AI_RUN_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {prettifyStatus(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("aiHarness.runs.daysLabel")}</FieldLabel>
              <Select value={daysFilter} onValueChange={setDaysFilter}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("aiHarness.runs.daysOption", { count: 7 })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {t("aiHarness.runs.daysOption", { count: days })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <div>
            <Button
              data-testid="ai-runs-refresh"
              onClick={() => void runsQuery.refetch()}
              disabled={runsQuery.isFetching}
            >
              <RefreshCw
                data-icon="inline-start"
                className={runsQuery.isFetching ? "animate-spin" : undefined}
              />
              {t("aiHarness.runs.refreshButton")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">
              {t("aiHarness.runs.tableTitle")}
            </CardTitle>
            <Badge variant="secondary">{runs.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <div className="flex flex-col gap-2" data-testid="ai-runs-skeleton">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : runsQuery.error != null ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t("aiHarness.runs.errorTitle")}</AlertTitle>
              <AlertDescription>
                {runsQuery.error instanceof Error
                  ? runsQuery.error.message
                  : t("aiHarness.runs.errorDescription")}
              </AlertDescription>
            </Alert>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("aiHarness.runs.emptyRuns")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="ai-runs-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">{t("aiHarness.runs.idColumn")}</th>
                    <th className="py-2 pr-4">
                      {t("aiHarness.runs.skillColumn")}
                    </th>
                    <th className="py-2 pr-4">
                      {t("aiHarness.runs.agentColumn")}
                    </th>
                    <th className="py-2 pr-4">
                      {t("aiHarness.runs.statusColumn")}
                    </th>
                    <th className="py-2 pr-4">
                      {t("aiHarness.runs.stepsColumn")}
                    </th>
                    <th className="py-2 pr-4">
                      {t("aiHarness.runs.tokensColumn")}
                    </th>
                    <th className="py-2 pr-4">
                      {t("aiHarness.runs.startedColumn")}
                    </th>
                    <th className="py-2 pr-4">
                      {t("aiHarness.runs.summaryColumn")}
                    </th>
                    <th className="py-2">{t("aiHarness.runs.actionsColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b last:border-0"
                      data-testid="ai-runs-row"
                    >
                      <td className="py-2 pr-4 font-mono text-xs">#{run.id}</td>
                      <td className="py-2 pr-4">
                        {run.skill_name ?? run.skill_key ?? "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {run.agent_name ?? `#${run.agent_id}`}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={aiRunStatusBadgeVariant(run.status)}>
                          {run.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">{run.step_count}</td>
                      <td className="py-2 pr-4">{run.tokens_used}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatMicros(run.started_at)}
                      </td>
                      <td className="max-w-[16rem] py-2 pr-4">
                        <span
                          className="block truncate"
                          title={run.summary ?? undefined}
                        >
                          {run.summary ?? "—"}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedRun(run)}
                          >
                            <ScrollText data-icon="inline-start" />
                            {t("aiHarness.runs.transcriptAction")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleInspectRun(run)}
                            disabled={inspector.isPending}
                          >
                            <FileSearch data-icon="inline-start" />
                            {t("aiHarness.runs.inspectAction")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRun != null && (
        <div className="flex flex-col gap-3" data-testid="ai-runs-transcript-section">
          {stepsQuery.error != null && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t("aiHarness.runs.transcriptErrorTitle")}</AlertTitle>
              <AlertDescription>
                {stepsQuery.error instanceof Error
                  ? stepsQuery.error.message
                  : t("aiHarness.runs.errorDescription")}
              </AlertDescription>
            </Alert>
          )}
          <AiRunTranscript
            run={stepsQuery.data?.run ?? selectedRun}
            steps={stepsQuery.data?.steps ?? []}
            attempts={stepsQuery.data?.attempts ?? []}
            cost={stepsQuery.data?.cost ?? EMPTY_COST}
            loading={stepsQuery.isPending || stepsQuery.isFetching}
          />
        </div>
      )}

      {(inspector.data != null || inspector.isPending || inspectError != null) && (
        <div className="flex flex-col gap-3" data-testid="ai-runs-inspector-section">
          {inspector.data?.correlation != null && (
            <p className="text-xs text-muted-foreground">
              {t("aiHarness.auditTrail.correlationId")}:{" "}
              <span className="font-mono">{inspector.data.correlation}</span>
            </p>
          )}
          <AiRunInspector
            viewKind={inspectView}
            payload={inspector.data?.payload ?? null}
            onInspectClaim={handleInspectClaim}
            loading={inspector.isPending}
            error={inspectError}
          />
        </div>
      )}
    </div>
  )
}
