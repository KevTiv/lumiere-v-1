"use client"

import { useTranslation } from "@lumiere/i18n"
import type { ModuleDataState } from "../lib/module-data-state"
import { Button } from "../components/button"

export function ModuleDataNotice({ state }: { state?: ModuleDataState }) {
  const { t } = useTranslation()
  if (!state || state.status === "ready" || state.status === "loading") return null
  const message = state.message ?? (state.status === "denied"
    ? t("common.recordsDenied", { defaultValue: "You do not have access to these records." })
    : state.status === "partial"
      ? t("common.recordsPartial", { defaultValue: "Some records could not be refreshed. Displayed records may be out of date." })
      : t("common.recordsUnavailable", { defaultValue: "Records could not be loaded." }))
  return <div role={state.status === "denied" ? "status" : "alert"} className="rounded-md border p-4 space-y-2">
    <p>{message}</p>
    {state.onRetry && state.status !== "denied" && <Button variant="outline" onClick={state.onRetry}>{t("common.retry", { defaultValue: "Retry" })}</Button>}
  </div>
}
