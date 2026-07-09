'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

/**
 * Parses `?filter=key:value` params from the URL for dashboard chart drill-down.
 * Multiple filters: `?filter=state:New&filter=status:open`
 */
export function useModuleFilters(): Record<string, string> {
  const searchParams = useSearchParams()

  return useMemo(() => {
    const filters: Record<string, string> = {}
    for (const entry of searchParams.getAll('filter')) {
      const colon = entry.indexOf(':')
      if (colon <= 0) continue
      const key = entry.slice(0, colon).trim()
      const value = entry.slice(colon + 1).trim()
      if (key && value) filters[key] = value
    }
    return filters
  }, [searchParams])
}
