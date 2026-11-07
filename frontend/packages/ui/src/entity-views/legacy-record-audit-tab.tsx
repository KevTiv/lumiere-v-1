"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import type { AuditLog } from "@lumiere/stdb/types"
import { useAuditLog } from "@lumiere/query-hooks/hooks/auth"
import { Badge } from "../components/badge"
import { Skeleton } from "../components/skeleton"
import { cn } from "../lib/utils"
import { useIdentityLabelMap } from "../hooks/use-identity-label-map"
import { resolveIdentityLabel } from "../lib/identity-label"
import { auditActionPillClass } from "../lib/theme-colors"
import {
  auditActionFromRow,
  auditRecordIdFromRow,
  auditTableNameFromRow,
  auditTimestampToIso,
  formatAuditEntryDetails,
} from "../lib/audit-log-utils"

interface RecordAuditTabProps {
  tableName: string
  recordId: string | number | bigint
  className?: string
}

function actionPillClass(action: string): string {
  return (
    auditActionPillClass[action] ??
    auditActionPillClass[action.toLowerCase()] ??
    "bg-muted text-muted-foreground"
  )
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function actorDisplayLabel(
  raw: unknown,
  labelMap: ReadonlyMap<string, string>,
): string {
  if (raw == null) return "System"
  const label = resolveIdentityLabel(raw, labelMap)
  return label === "—" ? "System" : label
}

/** Project only the canonical audit fields consumed here, retaining legacy wire aliases. */
function auditRow(row: AuditLog) {
  return {
    id: row.id,
    tableName: row.tableName ?? ("table_name" in row ? row.table_name : undefined),
    recordId: row.recordId ?? ("record_id" in row ? row.record_id : undefined),
    action: row.action,
    changedFields: row.changedFields ?? ("changed_fields" in row ? row.changed_fields : undefined),
    newValues: row.newValues ?? ("new_values" in row ? row.new_values : undefined),
    timestamp: row.timestamp,
    userIdentity: row.userIdentity ?? ("user_identity" in row ? row.user_identity : undefined),
  }
}

export function LegacyRecordAuditTab({ tableName, recordId, className }: RecordAuditTabProps) {
  const { t } = useTranslation()
  const { organizationId } = useErpSession()
  const orgReady = hasValidOrganizationId(organizationId)
  const orgBigInt = orgReady ? BigInt(organizationId) : 0n
  const auditQuery = useAuditLog(orgBigInt)
  const identityLabelMap = useIdentityLabelMap(orgBigInt)

  const recordIdStr = String(recordId)
  const tableNorm = tableName.trim().toLowerCase()

  const entries = useMemo(() => {
    const rows = auditQuery.data ?? []
    return rows.map(auditRow)
      .filter((r) => {
        const rowTable = auditTableNameFromRow(r).toLowerCase()
        const rowId = auditRecordIdFromRow(r)
        return rowTable === tableNorm && rowId === recordIdStr
      })
      .map((r) => {
        const action = auditActionFromRow(r)
        const details = formatAuditEntryDetails(r)
        const iso = auditTimestampToIso(r.timestamp)
        const actor = r.userIdentity
        return {
          id: String(r.id ?? `${action}-${iso}`),
          action,
          details,
          iso,
          actorLabel: actorDisplayLabel(actor, identityLabelMap),
        }
      })
      .sort((a, b) => new Date(b.iso).getTime() - new Date(a.iso).getTime())
  }, [auditQuery.data, recordIdStr, tableNorm, identityLabelMap])

  if (!orgReady) {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in to view audit history.
      </p>
    )
  }

  if (auditQuery.isLoading) {
    return (
      <div className={cn("space-y-3", className)} data-testid="record-audit-loading">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (auditQuery.isError) {
    return <p role="alert">{t("recordChanges.error")}</p>
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{t("businessHistory.legacyCoverage")}</p>
        <p data-testid="record-audit-empty">{t("businessHistory.legacyEmpty")}</p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-sm text-muted-foreground">{t("businessHistory.legacyCoverage")}</p>
    <ul className="space-y-3" data-testid="record-audit-list">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border border-border bg-card p-3 space-y-1.5"
          data-testid={`record-audit-entry-${entry.id}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={cn("text-xs font-medium", actionPillClass(entry.action))}
            >
              {entry.action || "EVENT"}
            </Badge>
            <time
              className="text-xs text-muted-foreground tabular-nums"
              dateTime={entry.iso}
              title={new Date(entry.iso).toLocaleString()}
            >
              {formatRelativeTime(entry.iso)}
            </time>
          </div>
          {entry.details ? (
            <p className="text-sm text-foreground">{entry.details}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">by {entry.actorLabel}</p>
        </li>
      ))}
    </ul>
    </div>
  )
}
