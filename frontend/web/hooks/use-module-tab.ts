'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { moduleTabDestination } from '@/lib/module-tab-navigation'

/**
 * Synchronises the active module tab with the URL's `?tab=` search param.
 * Falls back to defaultTab if the param is absent or not in validTabs.
 *
 * Defaults to replacing history. Workspaces can opt into push so Back restores
 * the previous workspace and its record filters.
 *
 * @example
 *   const { activeTab, setActiveTab } = useModuleTab(
 *     config.defaultTab ?? 'dashboard',
 *     config.tabs.map(t => t.id),
 *   )
 */
export function useModuleTab(
  defaultTab: string,
  validTabs: string[],
  { history = 'replace' }: { history?: 'push' | 'replace' } = {},
) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const rawTab = searchParams.get('tab')
  const activeTab = rawTab && validTabs.includes(rawTab) ? rawTab : defaultTab

  const setActiveTab = useCallback(
    (tab: string) => {
      const destination = moduleTabDestination({ pathname, query: searchParams.toString(), tab, defaultTab, validTabs })
      if (destination) router[history](destination, { scroll: false })
    },
    [searchParams, router, pathname, defaultTab, validTabs, history],
  )

  return { activeTab, setActiveTab }
}
