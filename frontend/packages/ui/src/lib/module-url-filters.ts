"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo } from "react"

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

/** Remove all `filter=key:*` entries while preserving unrelated query parameters. */
export function removeModuleFilterFromQuery(query: string, key: string): string {
  const next = new URLSearchParams(query)
  const remainingFilters = next
    .getAll("filter")
    .filter((entry) => !Object.hasOwn(parseModuleFilters([entry]), key))
  next.delete("filter")
  for (const filter of remainingFilters) next.append("filter", filter)
  return next.toString()
}

/** Filters from the current URL; empty outside a router context. */
export function useModuleUrlFilters(): Record<string, string> {
  const searchParams = useSearchParams()
  return useMemo(() => parseModuleFilters(searchParams?.getAll("filter") ?? []), [searchParams])
}

/** Remove one module-filter key while preserving the rest of the current query string. */
export function useClearModuleUrlFilter(): (key: string) => void {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  return useCallback(
    (key: string) => {
      const query = removeModuleFilterFromQuery(searchParams?.toString() ?? "", key)
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )
}
