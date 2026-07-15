"use client"

import { useEffect, useMemo } from "react"

import { useTranslation } from "@lumiere/i18n"
import {
  useClearOpportunityPresence,
  useOpportunityPresence,
  useUpdateOpportunityPresence,
} from "@lumiere/query-hooks/hooks/crm"
import { Badge } from "@/components/ui/badge"

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

export interface OpportunityPresenceBannerProps {
  organizationId: number
  opportunityId: bigint
  userName: string
}

/** Heartbeat presence while an opportunity record sheet is open. */
export function OpportunityPresenceBanner({
  organizationId,
  opportunityId,
  userName,
}: OpportunityPresenceBannerProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: rows = [] } = useOpportunityPresence(organization)
  const updatePresence = useUpdateOpportunityPresence(organization)
  const clearPresence = useClearOpportunityPresence(organization)

  useEffect(() => {
    const name = userName.trim() || "User"
    const tick = () => {
      void updatePresence.mutateAsync({ opportunityId, userName: name })
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => {
      window.clearInterval(id)
      void clearPresence.mutateAsync(opportunityId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate fns are stable enough for heartbeat
  }, [organizationId, opportunityId, userName])

  const viewers = useMemo(() => {
    const names = new Set<string>()
    for (const row of rows as Row[]) {
      if (asId(row.opportunityId ?? row.opportunity_id) !== opportunityId) continue
      const n = String(row.userName ?? row.user_name ?? "").trim()
      if (n) names.add(n)
    }
    return [...names]
  }, [rows, opportunityId])

  if (viewers.length === 0) return null

  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 text-sm"
      data-testid="opportunity-presence-banner"
    >
      <span className="text-muted-foreground">
        {t("crm.presence.viewing", "Also viewing")}
      </span>
      {viewers.map((name) => (
        <Badge key={name} variant="secondary">
          {name}
        </Badge>
      ))}
    </div>
  )
}
