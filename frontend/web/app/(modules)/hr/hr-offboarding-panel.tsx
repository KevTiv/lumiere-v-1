"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { QueryResourceState } from "@lumiere/api-client"
import {
  offboardingForEmployee,
  type OffboardingItemKey,
} from "@lumiere/query-hooks/hooks/hr-allocations"

type Row = Record<string, unknown>

const ITEM_LABELS: Record<OffboardingItemKey, { key: string; defaultValue: string }> = {
  assetsReturned: { key: "hr.offboarding.items.assetsReturned", defaultValue: "Assets returned" },
  accessRevoked: { key: "hr.offboarding.items.accessRevoked", defaultValue: "Access revoked" },
  docsCollected: { key: "hr.offboarding.items.docsCollected", defaultValue: "Documents collected" },
}

interface HrOffboardingPanelProps {
  state: QueryResourceState<Row> | undefined
  isLoading: boolean
  isError: boolean
  employeeId: number
}

/** Employee record sheet tab — read-only offboarding checklist items and completion state. */
export function HrOffboardingPanel({ state, isLoading, isError, employeeId }: HrOffboardingPanelProps) {
  const { t } = useTranslation()
  const view = useMemo(
    () => (state && state.status === "ready" ? offboardingForEmployee(state.rows, employeeId) : undefined),
    [state, employeeId],
  )

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p>
  }
  if (isError || state?.status === "unavailable") {
    return (
      <p className="text-sm text-destructive" role="alert">
        {t("hr.offboarding.loadError", { defaultValue: "Could not load the offboarding checklist." })}
      </p>
    )
  }
  if (!view) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("hr.offboarding.empty", { defaultValue: "No offboarding checklist for this employee." })}
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="hr-offboarding-panel">
      <p className="text-sm font-medium">
        {view.complete
          ? t("hr.offboarding.complete", { defaultValue: "Offboarding complete" })
          : t("hr.offboarding.progress", {
              defaultValue: "{{done}} of {{total}} steps done",
              done: view.doneCount,
              total: view.total,
            })}
      </p>
      <ul className="space-y-2">
        {view.items.map((item) => (
          <li key={item.key} className="rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>{t(ITEM_LABELS[item.key].key, { defaultValue: ITEM_LABELS[item.key].defaultValue })}</span>
              <span className={item.done ? "text-emerald-600" : "text-muted-foreground"}>
                {item.done
                  ? t("hr.offboarding.done", { defaultValue: "Done" })
                  : t("hr.offboarding.pending", { defaultValue: "Pending" })}
              </span>
            </div>
            {item.notes ? <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
