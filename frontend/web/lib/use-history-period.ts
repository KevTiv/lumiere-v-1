"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { parseHistoryPeriod, serializeHistoryPeriod, type HistoryPeriod } from "@lumiere/erp-shared/history-period"

/** Keep a selected period in a shareable link and restore it on browser navigation. */
export function useHistoryPeriod(fallback: HistoryPeriod = "all") {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const raw = searchParams?.get("period")
  const fallbackKey = serializeHistoryPeriod(fallback)
  const invalidPeriod = raw != null && parseHistoryPeriod(raw) === null
  const [period, setPeriod] = useState<HistoryPeriod>(() => parseHistoryPeriod(raw) ?? fallback)
  useEffect(() => { setPeriod(parseHistoryPeriod(raw) ?? parseHistoryPeriod(fallbackKey)!) }, [raw, fallbackKey])
  const changePeriod = useCallback((next: HistoryPeriod) => {
    setPeriod(next)
    const params = new URLSearchParams(searchParams?.toString())
    params.set("period", serializeHistoryPeriod(next))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, router, searchParams])
  return [period, changePeriod, invalidPeriod] as const
}
