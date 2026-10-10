"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { QueryResourceState } from "@lumiere/api-client"
import { statutoryIdsForEmployee } from "@lumiere/query-hooks/hooks/hr-allocations"

type Row = Record<string, unknown>

interface HrStatutoryIdsPanelProps {
  state: QueryResourceState<Row> | undefined
  isLoading: boolean
  isError: boolean
  employeeId: number
}

/**
 * Employee record sheet tab — statutory identifiers (read-only).
 * PII: the identifier is shown only masked to its last 4 characters, and only when the server
 * sent it (view_statutory_id). There is deliberately no reveal control, and the value is never
 * logged or exported.
 */
export function HrStatutoryIdsPanel({ state, isLoading, isError, employeeId }: HrStatutoryIdsPanelProps) {
  const { t } = useTranslation()
  const ids = useMemo(
    () => (state && state.status === "ready" ? statutoryIdsForEmployee(state.rows, employeeId) : []),
    [state, employeeId],
  )

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p>
  }
  if (isError || state?.status === "unavailable") {
    return (
      <p className="text-sm text-destructive" role="alert">
        {t("hr.statutoryIds.loadError", { defaultValue: "Could not load statutory IDs." })}
      </p>
    )
  }
  if (ids.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("hr.statutoryIds.empty", { defaultValue: "No statutory IDs on record." })}
      </p>
    )
  }

  return (
    <ul className="space-y-2" data-testid="hr-statutory-ids-panel">
      {ids.map((item) => (
        <li key={item.id} className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{item.idKind}</span>
            {item.maskedValue ? <span className="font-mono">{item.maskedValue}</span> : null}
          </div>
          <dl className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            {item.country ? (
              <div>
                <dt>{t("hr.statutoryIds.country", { defaultValue: "Country" })}</dt>
                <dd className="text-foreground">{item.country}</dd>
              </div>
            ) : null}
            {item.issueDate ? (
              <div>
                <dt>{t("hr.statutoryIds.issued", { defaultValue: "Issued" })}</dt>
                <dd className="text-foreground">{item.issueDate}</dd>
              </div>
            ) : null}
            {item.expiryDate ? (
              <div>
                <dt>{t("hr.statutoryIds.expires", { defaultValue: "Expires" })}</dt>
                <dd className="text-foreground">{item.expiryDate}</dd>
              </div>
            ) : null}
          </dl>
        </li>
      ))}
    </ul>
  )
}
