"use client"

import { useSearchParams } from "next/navigation"
import { useMemo } from "react"

/**
 * Parse `?filter=key:value` entries (chart drill-down, record links).
 * Multiple filters: `?filter=state:New&filter=status:open`. Later duplicates win.
 */
export function parseModuleFilters(entries: readonly string[]): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const entry of entries) {
    const colon = entry.indexOf(":")
    if (colon <= 0) continue
    const key = entry.slice(0, colon).trim()
    const value = entry.slice(colon + 1).trim()
    if (key && value) filters[key] = value
  }
  return filters
}

/** Filters from the current URL; empty outside a router context. */
export function useModuleUrlFilters(): Record<string, string> {
  const searchParams = useSearchParams()
  return useMemo(() => parseModuleFilters(searchParams?.getAll("filter") ?? []), [searchParams])
}
