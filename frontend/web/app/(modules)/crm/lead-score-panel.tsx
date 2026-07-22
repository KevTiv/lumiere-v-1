"use client"

import { useMemo } from "react"
import { GaugeIcon, RefreshCwIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
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

export interface LeadScorePanelProps {
  organizationId: number
  leadId: bigint
}

export function LeadScorePanel({ organizationId, leadId }: LeadScorePanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: scores = [], isLoading } = useLeadScores(organization)
  const { data: factors = [] } = useLeadScoreFactors(organization)
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
            disabled={recompute.isPending}
            onClick={() => recompute.mutate(leadId)}
          >
            <RefreshCwIcon className="size-4" />
            {t("crm.scoring.recompute", "Recompute")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
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
                {String(score.totalScore ?? score.total_score ?? 0)}
              </span>
              <Badge variant="secondary">
                {String(score.formulaVersion ?? score.formula_version ?? "")}
              </Badge>
            </div>
            <ul className="space-y-2">
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
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
