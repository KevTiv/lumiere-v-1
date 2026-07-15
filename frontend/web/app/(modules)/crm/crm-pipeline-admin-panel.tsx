"use client"

import { useMemo, useState } from "react"

import { useTranslation } from "@lumiere/i18n"
import {
  useAssignmentRules,
  useCreateAssignmentRule,
  useCreateLeadSource,
  useCreateOpportunityStage,
  useOpportunityStages,
} from "@lumiere/query-hooks/hooks/crm"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Row = Record<string, unknown>

export interface CrmPipelineAdminPanelProps {
  organizationId: number
}

export function CrmPipelineAdminPanel({ organizationId }: CrmPipelineAdminPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: stages = [] } = useOpportunityStages(organization)
  const { data: rules = [] } = useAssignmentRules(organization)
  const createStage = useCreateOpportunityStage(organization)
  const createSource = useCreateLeadSource(organization)
  const createRule = useCreateAssignmentRule(organization)

  const [stageName, setStageName] = useState("")
  const [stageProbability, setStageProbability] = useState("10")
  const [sourceName, setSourceName] = useState("")
  const [ruleName, setRuleName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const stageList = useMemo(
    () =>
      [...(stages as Row[])].sort(
        (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
      ),
    [stages],
  )

  async function onCreateStage() {
    setError(null)
    try {
      const nextSeq =
        stageList.reduce((max, s) => Math.max(max, Number(s.sequence ?? 0)), 0) + 10
      await createStage.mutateAsync({
        name: stageName.trim(),
        sequence: nextSeq,
        probability: Number(stageProbability) || 0,
        requirements: undefined,
        fold: false,
        isWon: false,
        teamId: undefined,
        isActive: true,
        metadata: undefined,
      })
      setStageName("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onCreateSource() {
    setError(null)
    try {
      await createSource.mutateAsync({
        name: sourceName.trim(),
        description: undefined,
        sequence: 10,
        isActive: true,
        metadata: undefined,
      })
      setSourceName("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onCreateRule() {
    setError(null)
    try {
      await createRule.mutateAsync({
        name: ruleName.trim(),
        model: "opportunity",
        domain: undefined,
        assignType: "round_robin",
        userIds: [],
        teamId: undefined,
        priority: 10,
        isActive: true,
        metadata: undefined,
      })
      setRuleName("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="crm-pipeline-admin">
      <Card>
        <CardHeader>
          <CardTitle>{t("crm.admin.stagesTitle", "Opportunity stages")}</CardTitle>
          <CardDescription>
            {t("crm.admin.stagesDescription", "Add pipeline stages instead of seed-only configuration.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="max-h-48 space-y-1 overflow-auto text-sm">
            {stageList.map((s) => (
              <li key={String(s.id)}>
                {String(s.name ?? "—")} · {Number(s.probability ?? 0)}%
              </li>
            ))}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor="stage-name">{t("crm.admin.stageName", "Name")}</Label>
            <Input
              id="stage-name"
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              data-testid="crm-admin-stage-name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="stage-prob">{t("crm.admin.stageProbability", "Probability %")}</Label>
            <Input
              id="stage-prob"
              value={stageProbability}
              onChange={(e) => setStageProbability(e.target.value)}
              data-testid="crm-admin-stage-probability"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!stageName.trim() || createStage.isPending}
            onClick={() => void onCreateStage()}
            data-testid="crm-admin-stage-create"
          >
            {t("crm.admin.createStage", "Create stage")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("crm.admin.sourcesTitle", "Lead sources")}</CardTitle>
          <CardDescription>
            {t("crm.admin.sourcesDescription", "Named sources for inbound qualification tracking.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="source-name">{t("crm.admin.sourceName", "Name")}</Label>
            <Input
              id="source-name"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              data-testid="crm-admin-source-name"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!sourceName.trim() || createSource.isPending}
            onClick={() => void onCreateSource()}
            data-testid="crm-admin-source-create"
          >
            {t("crm.admin.createSource", "Create source")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("crm.admin.rulesTitle", "Assignment rules")}</CardTitle>
          <CardDescription>
            {t("crm.admin.rulesDescription", "Route leads and opportunities (territories foundation).")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="max-h-40 space-y-1 overflow-auto text-sm">
            {(rules as Row[]).map((r) => (
              <li key={String(r.id)}>
                {String(r.name ?? "—")} · {String(r.model ?? "")} ·{" "}
                {r.isActive === false || r.is_active === false ? "off" : "on"}
              </li>
            ))}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-name">{t("crm.admin.ruleName", "Name")}</Label>
            <Input
              id="rule-name"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              data-testid="crm-admin-rule-name"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!ruleName.trim() || createRule.isPending}
            onClick={() => void onCreateRule()}
            data-testid="crm-admin-rule-create"
          >
            {t("crm.admin.createRule", "Create rule")}
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive lg:col-span-3">{error}</p> : null}
    </div>
  )
}
