"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { parseHistoryPeriod, serializeHistoryPeriod, type HistoryPeriod } from "@lumiere/erp-shared/history-period"

/** Keep a selected period in a shareable link and restore it on browser navigation. */
export function useHistoryPeriod(fallback: HistoryPeriod = "all") {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  // Next's snapshot can lag its native History integration by a transition.
  // A company-keyed remount must read the already-committed URL on its first render.
  // useSearchParams still subscribes us to subsequent URL/Back navigation updates.
  const raw = typeof window === "undefined"
    ? searchParams?.get("period")
    : new URLSearchParams(window.location.search).get("period")
  const fallbackKey = serializeHistoryPeriod(fallback)
  const invalidPeriod = raw != null && parseHistoryPeriod(raw) === null
  const [period, setPeriod] = useState<HistoryPeriod>(() => parseHistoryPeriod(raw) ?? fallback)
  useEffect(() => { setPeriod(parseHistoryPeriod(raw) ?? parseHistoryPeriod(fallbackKey)!) }, [raw, fallbackKey])
  const changePeriod = useCallback((next: HistoryPeriod) => {
    setPeriod(next)
    const params = new URLSearchParams(window.location.search)
    params.set("period", serializeHistoryPeriod(next))
    // Client-only filtering must commit the URL before a company-keyed remount.
    // Next integrates native history updates with useSearchParams without an RSC request.
    window.history.replaceState(null, "", `${pathname}?${params.toString()}${window.location.hash}`)
  }, [pathname])
  return [period, changePeriod, invalidPeriod] as const
}
