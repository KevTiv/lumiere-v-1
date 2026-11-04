"use client"

import { useEffect, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useCurrentUserProfile } from "@lumiere/query-hooks/hooks/auth"
import { resolveCalendarTimezone } from "@lumiere/erp-shared/calendar-timezone"

/** Reuses the canonical actor-keyed profile read; no setting is written on fallback. */
export function useCalendarTimezone() {
  const { identity, organizationId } = useErpSession()
  const signedIn = Boolean(identity && identity !== "unknown" && organizationId)
  const profile = useCurrentUserProfile(signedIn)
  const [browserTimezone, setBrowserTimezone] = useState<string | null>(null)
  useEffect(() => {
    try { setBrowserTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "") }
    catch { setBrowserTimezone("") }
  }, [])
  const resolved = resolveCalendarTimezone(signedIn && !profile.isError ? profile.data?.timezone : undefined, browserTimezone)
  return {
    ...resolved,
    ready: browserTimezone !== null && (!signedIn || !profile.isPending),
    profileUnavailable: signedIn && profile.isError,
    fallbackReason: resolved.source === "account" ? undefined : signedIn && profile.isError ? "profileUnavailable" as const : resolved.invalidAccount ? "invalidSetting" as const : resolved.source === "utc" ? "browserUnavailable" as const : "missingSetting" as const,
  }
}
