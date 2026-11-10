"use client"

import { useTranslation } from "@lumiere/i18n"
import { Badge } from "@lumiere/ui/components/badge"
import type { CaptureSyncState } from "@/lib/capture-sync-state"

export function CaptureSyncBadge({ state }: { state: CaptureSyncState }) {
  const { t } = useTranslation()
  const labels = {
    pending: t("captureSync.status.pending", { defaultValue: "Pending" }),
    syncing: t("captureSync.status.syncing", { defaultValue: "Syncing" }),
    synced: t("captureSync.status.synced", { defaultValue: "Synced" }),
    failed: t("captureSync.status.failed", { defaultValue: "Failed" }),
    conflict: t("captureSync.status.conflict", { defaultValue: "Conflict" }),
  }
  return (
    <Badge
      variant={
        state === "failed" || state === "conflict" ? "destructive" : "outline"
      }
      className="max-w-full whitespace-normal"
    >
      {labels[state]}
    </Badge>
  )
}
