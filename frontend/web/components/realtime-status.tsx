"use client"

import { skipToken, useQuery } from "@tanstack/react-query"
import { CloudOff } from "lucide-react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { realtimeAuthorityKey, type RealtimeAuthorityState } from "@lumiere/query-hooks/hooks/realtime"

export function RealtimeStatus() {
  const { identity, organizationId, activeCompanyId, activeCompanyReady } = useErpSession()
  const { t } = useTranslation()
  const scopeKey = activeCompanyReady && organizationId && activeCompanyId && identity && identity !== "unknown"
    ? realtimeAuthorityKey(organizationId, activeCompanyId, identity)
    : null
  const { data } = useQuery<RealtimeAuthorityState>({
    queryKey: scopeKey ?? ["realtime-authority"],
    queryFn: skipToken,
    enabled: false,
  })
  const reconnecting = Boolean(scopeKey && data?.phase === "reconnecting")
  const label = t("workspaceShell.realtimeReconnecting", {
    defaultValue: "Live updates paused. Recent changes may take longer to appear.",
  })

  return <span role="status" title={reconnecting ? label : undefined} className={reconnecting ? "inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground" : "sr-only"}>
    {reconnecting && <>
      <CloudOff className="size-4" aria-hidden="true" />
      <span aria-hidden="true" className="hidden whitespace-nowrap xl:inline">
        {t("workspaceShell.realtimePaused", { defaultValue: "Live updates paused" })}
      </span>
      <span className="sr-only">{label}</span>
    </>}
  </span>
}
