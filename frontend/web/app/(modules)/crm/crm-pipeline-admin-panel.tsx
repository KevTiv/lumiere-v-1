"use client"

import { useMemo, useState } from "react"

import { useTranslation } from "@lumiere/i18n"
import {
  useAssignmentRules,
  useCreateAssignmentRule,
  useCreateLeadLostReason,
  useCreateLeadSource,
  useCreateOpportunityStage,
  useLeadLostReasons,
  useLeadSources,
  useOpportunityStages,
  useUpdateAssignmentRule,
  useUpdateLeadLostReason,
  useUpdateLeadSource,
  useUpdateOpportunityStage,
} from "@lumiere/query-hooks/hooks/crm"
import { Badge } from "@/components/ui/badge"
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
import { Switch } from "@/components/ui/switch"
import { nullableBigIntU64 as asId } from "@lumiere/erp-shared/form-coercion"

type Row = Record<string, unknown>

function isActiveRow(row: Row): boolean {
  return row.isActive !== false && row.is_active !== false
}

export interface CrmPipelineAdminPanelProps {
  organizationId: number
}

export function CrmPipelineAdminPanel({ organizationId }: CrmPipelineAdminPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: stages = [] } = useOpportunityStages(organization)
  const { data: sources = [] } = useLeadSources(organization)
  const { data: lostReasons = [] } = useLeadLostReasons(organization)
  const { data: rules = [] } = useAssignmentRules(organization)

  const createStage = useCreateOpportunityStage(organization)
  const updateStage = useUpdateOpportunityStage(organization)
  const createSource = useCreateLeadSource(organization)
  const updateSource = useUpdateLeadSource(organization)
  const createLostReason = useCreateLeadLostReason(organization)
  const updateLostReason = useUpdateLeadLostReason(organization)
  const createRule = useCreateAssignmentRule(organization)
  const updateRule = useUpdateAssignmentRule(organization)

  const [stageName, setStageName] = useState("")
  const [stageProbability, setStageProbability] = useState("10")
  const [sourceName, setSourceName] = useState("")
  const [lostReasonName, setLostReasonName] = useState("")
  const [ruleName, setRuleName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const stageList = useMemo(
    () =>
      [...(stages as Row[])].sort(
        (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
      ),
    [stages],
  )

  const sourceList = useMemo(
    () =>
      [...(sources as Row[])].sort(
        (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
      ),
    [sources],
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

  async function onCreateLostReason() {
    setError(null)
    try {
      await createLostReason.mutateAsync({
        name: lostReasonName.trim(),
        description: undefined,
        isActive: true,
        metadata: undefined,
      })
      setLostReasonName("")
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
    <div className="grid gap-4 lg:grid-cols-2" data-testid="crm-pipeline-admin">
      <Card>
        <CardHeader>
          <CardTitle>{t("crm.admin.stagesTitle", "Opportunity stages")}</CardTitle>
          <CardDescription>
            {t(
              "crm.admin.stagesDescription",
              "Create stages and toggle active status for the pipeline board.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="max-h-56 space-y-2 overflow-auto text-sm">
            {stageList.map((s) => {
              const id = asId(s.id)
              const active = isActiveRow(s)
              return (
                <li
                  key={String(s.id)}
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{String(s.name ?? "—")}</div>
                    <div className="text-muted-foreground text-xs">
                      {Number(s.probability ?? 0)}% · seq {Number(s.sequence ?? 0)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={active ? "default" : "secondary"}>
                      {active
                        ? t("crm.admin.active", "Active")
                        : t("crm.admin.inactive", "Off")}
                    </Badge>
                    <Switch
                      checked={active}
                      disabled={!id || updateStage.isPending}
                      onCheckedChange={(checked) => {
                        if (!id) return
                        void updateStage
                          .mutateAsync({
                            stageId: id,
                            params: {
                              name: undefined,
                              sequence: undefined,
                              probability: undefined,
                              requirements: undefined,
                              fold: undefined,
                              isWon: undefined,
                              teamId: undefined,
                              isActive: checked,
                              metadata: undefined,
                            },
                          })
                          .catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : String(e)),
                          )
                      }}
                      aria-label={String(s.name ?? "stage")}
                    />
                  </div>
                </li>
              )
            })}
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
            {t(
              "crm.admin.sourcesDescription",
              "Named sources for inbound qualification tracking.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="max-h-56 space-y-2 overflow-auto text-sm">
            {sourceList.map((s) => {
              const id = asId(s.id)
              const active = isActiveRow(s)
              return (
                <li
                  key={String(s.id)}
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-2"
                >
                  <span className="truncate font-medium">{String(s.name ?? "—")}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={active ? "default" : "secondary"}>
                      {active
                        ? t("crm.admin.active", "Active")
                        : t("crm.admin.inactive", "Off")}
                    </Badge>
                    <Switch
                      checked={active}
                      disabled={!id || updateSource.isPending}
                      onCheckedChange={(checked) => {
                        if (!id) return
                        void updateSource
                          .mutateAsync({
                            sourceId: id,
                            params: {
                              name: undefined,
                              description: undefined,
                              sequence: undefined,
                              isActive: checked,
                              metadata: undefined,
                            },
                          })
                          .catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : String(e)),
                          )
                      }}
                      aria-label={String(s.name ?? "source")}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
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
          <CardTitle>{t("crm.admin.lostReasonsTitle", "Lost reasons")}</CardTitle>
          <CardDescription>
            {t(
              "crm.admin.lostReasonsDescription",
              "Reasons recorded when a lead or opportunity is lost.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="max-h-56 space-y-2 overflow-auto text-sm">
            {(lostReasons as Row[]).map((r) => {
              const id = asId(r.id)
              const active = isActiveRow(r)
              return (
                <li
                  key={String(r.id)}
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-2"
                >
                  <span className="truncate font-medium">{String(r.name ?? "—")}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={active ? "default" : "secondary"}>
                      {active
                        ? t("crm.admin.active", "Active")
                        : t("crm.admin.inactive", "Off")}
                    </Badge>
                    <Switch
                      checked={active}
                      disabled={!id || updateLostReason.isPending}
                      onCheckedChange={(checked) => {
                        if (!id) return
                        void updateLostReason
                          .mutateAsync({
                            lostReasonId: id,
                            params: {
                              name: undefined,
                              description: undefined,
                              isActive: checked,
                              metadata: undefined,
                            },
                          })
                          .catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : String(e)),
                          )
                      }}
                      aria-label={String(r.name ?? "lost reason")}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor="lost-reason-name">
              {t("crm.admin.lostReasonName", "Name")}
            </Label>
            <Input
              id="lost-reason-name"
              value={lostReasonName}
              onChange={(e) => setLostReasonName(e.target.value)}
              data-testid="crm-admin-lost-reason-name"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!lostReasonName.trim() || createLostReason.isPending}
            onClick={() => void onCreateLostReason()}
            data-testid="crm-admin-lost-reason-create"
          >
            {t("crm.admin.createLostReason", "Create lost reason")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("crm.admin.rulesTitle", "Assignment rules")}</CardTitle>
          <CardDescription>
            {t(
              "crm.admin.rulesDescription",
              "Route leads and opportunities (territories foundation).",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="max-h-56 space-y-2 overflow-auto text-sm">
            {(rules as Row[]).map((r) => {
              const id = asId(r.id)
              const active = isActiveRow(r)
              return (
                <li
                  key={String(r.id)}
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{String(r.name ?? "—")}</div>
                    <div className="text-muted-foreground text-xs">
                      {String(r.model ?? "")} · {String(r.assignType ?? r.assign_type ?? "")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={active ? "default" : "secondary"}>
                      {active
                        ? t("crm.admin.active", "Active")
                        : t("crm.admin.inactive", "Off")}
                    </Badge>
                    <Switch
                      checked={active}
                      disabled={!id || updateRule.isPending}
                      onCheckedChange={(checked) => {
                        if (!id) return
                        void updateRule
                          .mutateAsync({
                            ruleId: id,
                            params: {
                              name: undefined,
                              model: undefined,
                              domain: undefined,
                              assignType: undefined,
                              userIds: undefined,
                              teamId: undefined,
                              priority: undefined,
                              isActive: checked,
                              metadata: undefined,
                            },
                          })
                          .catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : String(e)),
                          )
                      }}
                      aria-label={String(r.name ?? "rule")}
                    />
                  </div>
                </li>
              )
            })}
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

      {error ? <p className="text-sm text-destructive lg:col-span-2">{error}</p> : null}
    </div>
  )
}
