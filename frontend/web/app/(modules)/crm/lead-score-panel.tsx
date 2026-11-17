"use client"

import { useMemo } from "react"
import { GaugeIcon, RefreshCwIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import {
  useLeadScoreFactors,
  useLeadScores,
  useRecomputeLeadScore,
} from "@lumiere/query-hooks/hooks/crm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"

type Row = Record<string, unknown>

function formatWhen(value: unknown): string | null {
  const raw = optionValue(value)
  if (raw == null) return null
  if (typeof raw === "object" && raw !== null && "microsSinceUnixEpoch" in raw) {
    const micros = Number((raw as { microsSinceUnixEpoch: bigint | number }).microsSinceUnixEpoch)
    if (!Number.isFinite(micros) || micros <= 0) return null
    return new Date(micros / 1000).toLocaleString()
  }
  return String(raw)
}

export interface LeadScorePanelProps {
  organizationId: number
  leadId: bigint
}

export function LeadScorePanel({ organizationId, leadId }: LeadScorePanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { rows: scores, state: scoreState } = moduleCollection(useLeadScores(organization))
  const { rows: factors, state: factorState } = moduleCollection(useLeadScoreFactors(organization))
  const recompute = useRecomputeLeadScore(organization)

  const score = useMemo(() => {
    return (scores as Row[]).find((row) => asId(row.leadId ?? row.lead_id) === leadId) ?? null
  }, [scores, leadId])

  const factorRows = useMemo(() => {
    return (factors as Row[])
      .filter((row) => asId(row.leadId ?? row.lead_id) === leadId)
      .sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0))
  }, [factors, leadId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crm.scoring.title", "Lead score")}</CardTitle>
        <CardDescription>
          {t("crm.scoring.description", "Explainable fit factors (deterministic baseline).")}
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant="outline"
            disabled={recompute.isPending || scoreState.status !== "ready"}
            onClick={() => recompute.mutate(leadId)}
          >
            <RefreshCwIcon className="size-4" />
            {t("crm.scoring.recompute", "Recompute")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {recompute.isError ? <p role="alert" className="text-sm text-destructive">{recompute.error.message}</p> : null}
        {scoreState.status === "loading" ? (
          <p role="status" className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
        ) : scoreState.status !== "ready" ? (
          <ModuleDataNotice state={scoreState} />
        ) : !score ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GaugeIcon />
              </EmptyMedia>
              <EmptyTitle>{t("crm.scoring.emptyTitle", "No score yet")}</EmptyTitle>
              <EmptyDescription>
                {t("crm.scoring.emptyDescription", "Recompute to generate explainable factors.")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-semibold tabular-nums">
                {String(score.totalScore ?? score.total_score ?? "—")}
              </span>
              <Badge variant="secondary">
                {String(score.formulaVersion ?? score.formula_version ?? "")}
              </Badge>
              {Boolean(score.isStale ?? score.is_stale) ? (
                <Badge variant="destructive">{t("crm.scoring.stale", "Stale")}</Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {(() => {
                const staleSince = formatWhen(score.staleSince ?? score.stale_since)
                if (Boolean(score.isStale ?? score.is_stale) && staleSince) {
                  return t("crm.scoring.staleSince", "Stale since {{date}}", { date: staleSince })
                }
                const scoredAt = formatWhen(score.scoredAt ?? score.scored_at)
                return scoredAt
                  ? t("crm.scoring.scoredAt", "Scored {{date}}", { date: scoredAt })
                  : null
              })()}
            </p>
            {factorState.status === "loading" ? (
              <p role="status" className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : factorState.status !== "ready" ? (
              <ModuleDataNotice state={factorState} />
            ) : <ul className="space-y-2">
              {factorRows.map((factor) => (
                <li
                  key={String(factor.id)}
                  className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 text-sm last:border-0"
                >
                  <div>
                    <div className="font-medium">
                      {String(factor.label ?? factor.factorKey ?? factor.factor_key)}
                    </div>
                    {(factor.evidence as string | undefined) ? (
                      <div className="text-muted-foreground text-xs">
                        {String(optionValue(factor.evidence))}
                      </div>
                    ) : null}
                  </div>
                  <Badge variant="outline">+{String(factor.points ?? 0)}</Badge>
                </li>
              ))}
            </ul>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
