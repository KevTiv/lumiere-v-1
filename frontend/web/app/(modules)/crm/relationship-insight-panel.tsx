"use client"

import { useMemo } from "react"
import { NetworkIcon, RefreshCwIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  useContactRelationshipInsights,
  useRecomputeRelationshipInsights,
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

type Row = Record<string, unknown>

function optionValue(value: unknown): unknown {
  if (value != null && typeof value === "object" && "some" in value) {
    return (value as { some: unknown }).some
  }
  return value
}

function asId(value: unknown): bigint | null {
  const raw = optionValue(value)
  if (raw == null || raw === "") return null
  try {
    return typeof raw === "bigint" ? raw : BigInt(String(raw))
  } catch {
    return null
  }
}

export interface RelationshipInsightPanelProps {
  organizationId: number
  contactId: bigint
}

export function RelationshipInsightPanel({
  organizationId,
  contactId,
}: RelationshipInsightPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: insights = [] } = useContactRelationshipInsights(organization)
  const recompute = useRecomputeRelationshipInsights(organization)

  const insight = useMemo(() => {
    return (
      (insights as Row[]).find((row) => asId(row.contactId ?? row.contact_id) === contactId) ??
      null
    )
  }, [insights, contactId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crm.relIntel.title", "Relationship intelligence")}</CardTitle>
        <CardDescription>
          {t(
            "crm.relIntel.description",
            "Strength from active relationships and hierarchy depth.",
          )}
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant="outline"
            disabled={recompute.isPending}
            onClick={() => recompute.mutate(contactId)}
          >
            <RefreshCwIcon className="size-4" />
            {t("crm.relIntel.recompute", "Recompute")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!insight ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <NetworkIcon className="size-4" />
            {t("crm.relIntel.empty", "No insight yet — recompute to generate.")}
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{String(insight.strengthScore ?? insight.strength_score ?? 0)}</Badge>
              <span>
                {t("crm.relIntel.relationships", "Relationships")}:{" "}
                {String(
                  insight.activeRelationshipCount ?? insight.active_relationship_count ?? 0,
                )}
              </span>
              <span>
                {t("crm.relIntel.depth", "Depth")}:{" "}
                {String(insight.hierarchyDepth ?? insight.hierarchy_depth ?? 0)}
              </span>
            </div>
            <p className="text-muted-foreground">{String(insight.summary ?? "")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
